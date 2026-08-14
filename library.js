import fs from 'node:fs';
import path from 'node:path';
import { guessit } from 'guessit-js';

const video = /\.(mkv|mp4|webm|m4v)$/i;
const text = (source, tag) => source.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'))?.[1]?.trim();
const nfoFor = (mediaRoot, file) => {
  const directory = path.dirname(path.join(mediaRoot, file));
  const stem = path.basename(file, path.extname(file));
  const nfoPath = [path.join(directory, `${stem}.nfo`), path.join(directory, 'movie.nfo')].find(fs.existsSync);
  if (!nfoPath) return {};
  try {
    const source = fs.readFileSync(nfoPath, 'utf8');
    return {
      title: text(source, 'title'),
      year: Number(text(source, 'year')) || null,
      imdbId: source.match(/<uniqueid[^>]*type=["']imdb["'][^>]*>(tt\d{7,10})<\/uniqueid>/i)?.[1] || text(source, 'id')?.match(/^tt\d{7,10}$/i)?.[0]?.toLowerCase(),
    };
  } catch { return {}; }
};


const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function catalogGroupKey(item) {
  const imdb = item.imdbId || item.suggestedImdbId || null;
  const episode = item.type === 'episode' || (item.season != null && item.episode != null);
  if (episode) {
    return imdb && item.season != null && item.episode != null ? `${imdb}:${item.season}:${item.episode}` : null;
  }
  if (imdb) return imdb;
  const title = slug(item.title);
  return title ? `${title}${item.year ? `-${item.year}` : ''}` : null;
}

const uniqueFiles = files => {
  const seen = new Set();
  return files.filter(file => {
    if (seen.has(file.id)) return false;
    seen.add(file.id);
    return true;
  });
};

export function catalogTitleKey(item) {
  return catalogGroupKey({ ...item, imdbId: null, suggestedImdbId: null });
}

export function catalogAliases(item) {
  return new Set([item?.id, item?.imdbId, item?.suggestedImdbId, catalogTitleKey(item)].filter(Boolean));
}

export function groupCatalog(items) {
  const groups = new Map();
  for (const item of items) {
    const key = catalogGroupKey(item) || item.id;
    const members = groups.get(key);
    if (members) members.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].flatMap(([id, members]) => {
    const files = uniqueFiles(members
      .filter(member => (member.size || 0) > 0)
      .map(member => ({ id: member.id, file: member.file, size: member.size || 0 }))
      .sort((a, b) => b.size - a.size || a.file.localeCompare(b.file)));
    if (!files.length) return [];
    const representative = members.find(member => member.id === files[0].id) || members[0];
    return [{ ...representative, id, file: files[0].file, files, size: files[0].size }];
  });
}

export function catalogMembers(item, requestedId) {
  const files = (item?.files || (item ? [{ id: item.id, file: item.file, size: item.size || 0 }] : []))
    .filter(file => (file.size || 0) > 0)
    .slice()
    .sort((a, b) => (b.size || 0) - (a.size || 0) || String(a.file).localeCompare(String(b.file)));
  if (requestedId && item && !catalogAliases(item).has(requestedId)) {
    const match = files.find(file => file.id === requestedId);
    return match ? [match] : [];
  }
  return files;
}

export function createLibrary(mediaRoot, indexPath, tmdbApiKey) {
  const metadataCache = new Map();
  const load = () => {
    try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { return { mappings: {} }; }
  };
  const save = index => {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  };
  const discover = async item => {
    if (item.imdbId || !tmdbApiKey || !item.title) return item;
    const type = item.type === 'episode' ? 'tv' : 'movie';
    const query = new URLSearchParams({ api_key: tmdbApiKey, query: item.title });
    if (item.year) query.set(type === 'movie' ? 'year' : 'first_air_date_year', item.year);
    const results = await fetch(`https://api.themoviedb.org/3/search/${type}?${query}`).then(res => res.ok ? res.json() : { results: [] });
    const candidate = results.results?.[0];
    if (!candidate) return item;
    const candidateTitle = candidate.title || candidate.name || '';
    const candidateYear = (candidate.release_date || candidate.first_air_date || '').slice(0, 4);
    const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const confident = Boolean(item.year) && normalize(candidateTitle) === normalize(item.title) && candidateYear === String(item.year);
    if (!confident) return { ...item, candidate: { title: candidateTitle, year: candidateYear, tmdbId: candidate.id } };
    const external = await fetch(`https://api.themoviedb.org/3/${type}/${candidate.id}/external_ids?api_key=${tmdbApiKey}`).then(res => res.ok ? res.json() : {});
    return { ...item, suggestedImdbId: external.imdb_id || null, autoMapped: Boolean(external.imdb_id), candidate: { title: candidateTitle, year: candidateYear, tmdbId: candidate.id } };
  };
  const tmdb = async (endpoint, query = {}) => {
    if (!tmdbApiKey) return null;
    const params = new URLSearchParams({ api_key: tmdbApiKey, ...query });
    const response = await fetch(`https://api.themoviedb.org/3${endpoint}?${params}`);
    return response.ok ? response.json() : null;
  };
  const imageUrl = (image, size) => image ? `https://image.tmdb.org/t/p/${size}${image}` : null;
  const metadataFor = async item => {
    const key = `${item.imdbId || ''}:${item.title}:${item.year || ''}:${item.type}`;
    if (metadataCache.has(key)) return metadataCache.get(key);
    const pending = (async () => {
      if (!tmdbApiKey) return item;
      const type = item.type === 'episode' ? 'tv' : 'movie';
      let result;
      if (item.imdbId) {
        const external = await tmdb(`/find/${item.imdbId}`, { external_source: 'imdb_id' });
        result = external?.[type === 'tv' ? 'tv_results' : 'movie_results']?.[0];
      }
      if (!result) {
        const query = { query: item.title };
        if (item.year) query[type === 'tv' ? 'first_air_date_year' : 'year'] = item.year;
        result = (await tmdb(`/search/${type}`, query))?.results?.[0];
      }
      if (!result?.id) return item;
      const detail = await tmdb(`/${type}/${result.id}`, { append_to_response: 'external_ids' });
      if (!detail) return item;
      const releaseDate = detail.release_date || detail.first_air_date || '';
      return {
        ...item,
        imdbId: item.imdbId || detail.external_ids?.imdb_id || null,
        posterUrl: imageUrl(detail.poster_path, 'w500'),
        backgroundUrl: imageUrl(detail.backdrop_path, 'w1280'),
        overview: detail.overview || null,
        description: detail.overview || item.description || null,
        runtime: detail.runtime || detail.episode_run_time?.[0] || null,
        genres: detail.genres?.map(genre => genre.name).filter(Boolean) || [],
        releaseYear: Number(releaseDate.slice(0, 4)) || item.year || null,
        rating: typeof detail.vote_average === 'number' ? detail.vote_average : null,
      };
    })().catch(() => item);
    metadataCache.set(key, pending);
    return pending;
  };
  let cachedScan = null;
  const scan = async () => {
    const index = load();
    const listed = fs.existsSync(mediaRoot) ? fs.readdirSync(mediaRoot, { recursive: true }).filter(file => video.test(file)) : [];
    const present = new Set();
    const items = [];
    let changed = false;
    for (const file of listed) {
      let stat;
      try { stat = fs.statSync(path.join(mediaRoot, file)); } catch { continue; }
      if (!stat.isFile()) continue;
      present.add(file);
      const fingerprint = `${stat.size}:${Math.round(stat.mtimeMs)}`;
      const parsed = guessit(path.basename(file));
      const previous = Object.entries(index.mappings).find(([oldPath, value]) => oldPath !== file && value.missing && value.fingerprint === fingerprint)?.[1];
      const mapping = index.mappings[file] || previous || {};
      const nfo = nfoFor(mediaRoot, file);
      if (mapping.fingerprint !== fingerprint || mapping.missing) {
        index.mappings[file] = { ...mapping, fingerprint, missing: false, updatedAt: mapping.updatedAt || new Date().toISOString() };
        changed = true;
      }
      items.push({
        file,
        id: Buffer.from(file).toString('base64url'),
        size: stat.size,
        title: mapping.title || nfo.title || parsed.title || path.basename(file, path.extname(file)),
        year: mapping.year || nfo.year || parsed.year || null,
        imdbId: mapping.imdbId || nfo.imdbId || parsed.imdb_id || file.match(/\btt\d{7,10}\b/i)?.[0]?.toLowerCase() || null,
        type: parsed.type === 'episode' ? 'episode' : 'video',
        season: mapping.season || parsed.season || null,
        episode: mapping.episode || parsed.episode || null,
        mapped: Boolean(mapping.imdbId),
      });
    }
    for (const file of Object.keys(index.mappings)) {
      if (present.has(file) || index.mappings[file].missing) continue;
      const size = Number(String(index.mappings[file].fingerprint || '').split(':')[0]);
      if (size > 0) continue;
      index.mappings[file].missing = true;
      changed = true;
    }
    const discovered = await Promise.all(items.map(discover));
    for (const item of discovered) {
      if (!item.autoMapped || index.mappings[item.file]?.imdbId) continue;
      index.mappings[item.file] = {
        title: item.title,
        year: item.year,
        imdbId: item.suggestedImdbId,
        source: 'tmdb-auto',
        confidence: 'high',
        missing: false,
        fingerprint: index.mappings[item.file]?.fingerprint,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    }
    if (changed) save(index);
    cachedScan = discovered;
    return discovered;
  };
  const itemsFromIndex = () => Object.entries(load().mappings).flatMap(([file, mapping]) => {
    const size = Number(String(mapping.fingerprint || '').split(':')[0]);
    if (!size || !video.test(file) || file.includes('..')) return [];
    const parsed = guessit(path.basename(file));
    return [{
      file,
      id: Buffer.from(file).toString('base64url'),
      size,
      title: mapping.title || parsed.title || path.basename(file, path.extname(file)),
      year: mapping.year || parsed.year || null,
      imdbId: mapping.imdbId || parsed.imdb_id || file.match(/\btt\d{7,10}\b/i)?.[0]?.toLowerCase() || null,
      type: parsed.type === 'episode' ? 'episode' : 'video',
      season: mapping.season || parsed.season || null,
      episode: mapping.episode || parsed.episode || null,
      mapped: Boolean(mapping.imdbId),
    }];
  });
  const findItem = (items, id) => items.find(item => catalogAliases(item).has(id) || item.files?.some(file => file.id === id)) || null;
  return {
    scan,
    startReconciler(seconds = 900) {
      const refresh = () => scan().catch(error => console.error('Library reconciliation failed', error));
      refresh();
      setInterval(refresh, seconds * 1000).unref();
      try {
        let pending;
        fs.watch(mediaRoot, () => { clearTimeout(pending); pending = setTimeout(refresh, 1_000); });
      } catch (error) {
        console.warn('Library watcher unavailable; periodic reconciliation remains active', error.message);
      }
    },
    saveMapping(file, mapping) {
      const index = load();
      index.mappings[file] = { ...index.mappings[file], ...mapping, missing: false, updatedAt: new Date().toISOString() };
      save(index);
    },
    async catalog() {
      return groupCatalog(await Promise.all((await scan()).map(metadataFor)));
    },
    async metadata(id) {
      return findItem(await this.catalog(), id);
    },
    async members(id) {
      const grouped = groupCatalog(cachedScan || itemsFromIndex());
      const item = findItem(grouped, id);
      return item ? catalogMembers(item, id) : null;
    },
  };
}
