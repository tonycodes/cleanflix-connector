import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogAliases, catalogGroupKey, catalogMembers, groupCatalog } from './library.js';

const pathId = file => Buffer.from(file).toString('base64url');

test('two files with the same imdbId become one catalog item with two streams', () => {
  const items = [
    { id: pathId('Evolution.mp4'), file: 'Evolution.mp4', title: 'Evolution', year: 2026, imdbId: 'tt6150344', type: 'video', size: 100 },
    { id: pathId('Evolution (2026)/Evolution.mp4'), file: 'Evolution (2026)/Evolution.mp4', title: 'Evolution', year: 2026, imdbId: 'tt6150344', type: 'video', size: 250 },
  ];
  const catalog = groupCatalog(items);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, 'tt6150344');
  assert.equal(catalog[0].title, 'Evolution');
  assert.equal(catalog[0].year, 2026);
  assert.equal(catalog[0].imdbId, 'tt6150344');
  const streams = catalogMembers(catalog[0], catalog[0].id);
  assert.equal(streams.length, 2);
  assert.equal(streams[0].file, 'Evolution (2026)/Evolution.mp4');
  assert.equal(streams[1].file, 'Evolution.mp4');
  assert.equal(streams[0].id, pathId('Evolution (2026)/Evolution.mp4'));
});

test('metadata keeps path-id as an alias of the group', () => {
  const path = pathId('copy-a.mp4');
  const catalog = groupCatalog([
    { id: path, file: 'copy-a.mp4', title: 'Evolution', year: 2026, imdbId: 'tt6150344', type: 'video', size: 10 },
    { id: pathId('copy-b.mp4'), file: 'copy-b.mp4', title: 'Evolution', year: 2026, suggestedImdbId: 'tt6150344', type: 'video', size: 20 },
  ]);
  const item = catalog.find(entry => entry.id === 'tt6150344' || entry.files.some(file => file.id === path));
  assert.equal(item.id, 'tt6150344');
  assert.equal(catalogMembers(item, path).length, 1);
  assert.equal(catalogMembers(item, path)[0].file, 'copy-a.mp4');
});

test('episodes group by imdbId:season:episode and never collapse a series', () => {
  const items = [
    { id: 'e1', file: 'Show.S01E01.mkv', title: 'Show', year: 2020, imdbId: 'tt1111111', type: 'episode', season: 1, episode: 1, size: 1 },
    { id: 'e2', file: 'Show.S01E02.mkv', title: 'Show', year: 2020, imdbId: 'tt1111111', type: 'episode', season: 1, episode: 2, size: 1 },
    { id: 'e1b', file: 'Show.S01E01.alt.mkv', title: 'Show', year: 2020, imdbId: 'tt1111111', type: 'episode', season: 1, episode: 1, size: 2 },
  ];
  const catalog = groupCatalog(items);
  assert.equal(catalog.length, 2);
  assert.deepEqual(new Set(catalog.map(item => item.id)), new Set(['tt1111111:1:1', 'tt1111111:1:2']));
  assert.equal(catalog.find(item => item.id === 'tt1111111:1:1').files.length, 2);
});

test('unmapped titles group by lowercase title and year', () => {
  const catalog = groupCatalog([
    { id: 'a', file: 'a.mp4', title: 'Evolution', year: 2026, type: 'video', size: 1 },
    { id: 'b', file: 'b.mp4', title: 'evolution', year: 2026, type: 'video', size: 2 },
  ]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, 'evolution-2026');
  assert.equal(catalogGroupKey({ title: 'Evolution', year: 2026, type: 'video' }), 'evolution-2026');
});

test('size-0 torrent folders are dropped when a real file exists', () => {
  const catalog = groupCatalog([
    { id: 'dir', file: 'Rons.Gone.Wrong.2021.mkv', title: 'Rons Gone Wrong', year: 2021, type: 'video', size: 0 },
    { id: 'real', file: 'Rons.Gone.Wrong.2021.mkv/Rons.Gone.Wrong.2021.mkv', title: 'Rons Gone Wrong', year: 2021, type: 'video', size: 1506040768 },
    { id: 'yts', file: 'Rons Gone Wrong (2021)/Rons.Gone.Wrong.2021.mp4', title: 'Rons Gone Wrong', year: 2021, type: 'video', size: 2112849010 },
  ]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, 'rons-gone-wrong-2021');
  assert.equal(catalog[0].size, 2112849010);
  assert.deepEqual(catalog[0].files.map(file => file.id), ['yts', 'real']);
  assert.equal(catalogMembers(catalog[0], catalog[0].id).length, 2);
});

test('duplicate file ids collapse to one stream', () => {
  const catalog = groupCatalog([
    { id: 'a', file: 'Movie.mp4', title: 'Movie', year: 2020, type: 'video', size: 10 },
    { id: 'a', file: 'Movie.mp4', title: 'Movie', year: 2020, type: 'video', size: 10 },
  ]);
  assert.equal(catalog[0].files.length, 1);
});

test('a size-0-only group is omitted', () => {
  const catalog = groupCatalog([
    { id: 'dir', file: 'Rons.Gone.Wrong.2021.mkv', title: 'Rons Gone Wrong', year: 2021, type: 'video', size: 0 },
  ]);
  assert.equal(catalog.length, 0);
});

test('title-year id still resolves after imdb grouping', () => {
  const catalog = groupCatalog([
    { id: 'a', file: 'Rons.mkv', title: 'Rons Gone Wrong', year: 2021, imdbId: 'tt7504818', type: 'video', size: 10 },
    { id: 'b', file: 'Rons.mp4', title: 'Rons Gone Wrong', year: 2021, imdbId: 'tt7504818', type: 'video', size: 20 },
  ]);
  assert.equal(catalog[0].id, 'tt7504818');
  assert.equal(catalogMembers(catalog[0], 'rons-gone-wrong-2021').length, 2);
  assert.ok(catalogAliases(catalog[0]).has('rons-gone-wrong-2021'));
});
