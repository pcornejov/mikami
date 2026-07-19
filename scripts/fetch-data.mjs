#!/usr/bin/env node
// Descarga datos de Ghost Sweeper Mikami desde APIs publicas sin autenticacion.
// Prioridad: Jikan API (MyAnimeList). Fallback: AniList GraphQL.
// Los resultados se guardan como JSON estatico en src/data/ para que la web
// final no realice llamadas a APIs en tiempo de ejecucion.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const ANILIST_BASE = 'https://graphql.anilist.co';
const ANIME_TITLE = 'Ghost Sweeper Mikami';
const ANIME_MAL_ID = 429; // fallback conocido, se resuelve por busqueda igualmente
const JIKAN_DELAY_MS = 400; // ~3 req/seg de margen

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jikanGet(pathAndQuery, { retries = 3 } = {}) {
  const url = `${JIKAN_BASE}${pathAndQuery}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      await sleep(JIKAN_DELAY_MS);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.status && json.status >= 400) {
        throw new Error(`Jikan error status ${json.status}: ${json.message ?? ''}`);
      }
      return json;
    } catch (err) {
      console.warn(`  [jikan] intento ${attempt}/${retries} fallo para ${pathAndQuery}: ${err.message}`);
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  return null;
}

async function anilistQuery(query, variables = {}) {
  const res = await fetch(ANILIST_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`AniList HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`AniList error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function findJikanAnimeId() {
  const search = await jikanGet(`/anime?q=${encodeURIComponent(ANIME_TITLE)}&limit=5`);
  const first = search?.data?.[0];
  return first?.mal_id ?? ANIME_MAL_ID;
}

async function fetchAnimeInfo() {
  console.log('-> Descargando info del anime...');
  const malId = await findJikanAnimeId();
  const jikanAnime = malId ? await jikanGet(`/anime/${malId}/full`) : null;

  if (jikanAnime?.data) {
    const d = jikanAnime.data;
    return {
      source: 'jikan',
      title: d.title,
      titleEnglish: d.title_english,
      titleJapanese: d.title_japanese,
      synopsis: d.synopsis,
      episodes: d.episodes,
      status: d.status,
      aired: { from: d.aired?.from, to: d.aired?.to },
      genres: (d.genres ?? []).map((g) => g.name),
      studios: (d.studios ?? []).map((s) => s.name),
      score: d.score,
      image: d.images?.jpg?.large_image_url,
      trailer: d.trailer?.url ?? null,
    };
  }

  console.log('  [fallback] usando AniList para info del anime');
  const data = await anilistQuery(`
    query($search: String) {
      Media(search: $search, type: ANIME) {
        title { romaji english native }
        description
        episodes
        status
        startDate { year month day }
        endDate { year month day }
        coverImage { large extraLarge }
        bannerImage
        genres
        studios(isMain: true) { nodes { name } }
        averageScore
        trailer { id site }
      }
    }
  `, { search: ANIME_TITLE });

  const m = data.Media;
  const fmt = (d) => (d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}` : null);
  return {
    source: 'anilist',
    title: m.title.romaji,
    titleEnglish: m.title.english,
    titleJapanese: m.title.native,
    synopsis: m.description?.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''),
    episodes: m.episodes,
    status: m.status,
    aired: { from: fmt(m.startDate), to: fmt(m.endDate) },
    genres: m.genres,
    studios: (m.studios?.nodes ?? []).map((s) => s.name),
    score: m.averageScore ? m.averageScore / 10 : null,
    image: m.coverImage?.extraLarge ?? m.coverImage?.large,
    banner: m.bannerImage ?? null,
    trailer: m.trailer ? `https://www.youtube.com/watch?v=${m.trailer.id}` : null,
  };
}

async function fetchMangaInfo() {
  console.log('-> Descargando info del manga...');
  const search = await jikanGet(`/manga?q=${encodeURIComponent(ANIME_TITLE)}&limit=5`);
  const first = search?.data?.[0];
  const jikanManga = first ? await jikanGet(`/manga/${first.mal_id}/full`) : null;

  if (jikanManga?.data) {
    const d = jikanManga.data;
    return {
      source: 'jikan',
      title: d.title,
      synopsis: d.synopsis,
      chapters: d.chapters,
      volumes: d.volumes,
      status: d.status,
      published: { from: d.published?.from, to: d.published?.to },
      authors: (d.authors ?? []).map((a) => a.name),
      genres: (d.genres ?? []).map((g) => g.name),
      image: d.images?.jpg?.large_image_url,
    };
  }

  console.log('  [fallback] usando AniList para info del manga');
  const data = await anilistQuery(`
    query($search: String) {
      Media(search: $search, type: MANGA) {
        title { romaji english native }
        description
        chapters
        volumes
        status
        startDate { year month day }
        endDate { year month day }
        coverImage { large extraLarge }
        staff(perPage: 5) { nodes { name { full } primaryOccupations } }
      }
    }
  `, { search: ANIME_TITLE });

  const m = data.Media;
  const fmt = (d) => (d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}` : null);
  return {
    source: 'anilist',
    title: m.title.romaji,
    synopsis: m.description?.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''),
    chapters: m.chapters,
    volumes: m.volumes,
    status: m.status,
    published: { from: fmt(m.startDate), to: fmt(m.endDate) },
    authors: (m.staff?.nodes ?? []).map((s) => s.name.full),
    image: m.coverImage?.extraLarge ?? m.coverImage?.large,
  };
}

async function fetchCharacters() {
  console.log('-> Descargando personajes...');
  const malId = await findJikanAnimeId();
  const jikanChars = malId ? await jikanGet(`/anime/${malId}/characters`) : null;

  if (jikanChars?.data?.length) {
    return jikanChars.data.map((c) => ({
      source: 'jikan',
      id: c.character.mal_id,
      name: c.character.name,
      role: c.role,
      image: c.character.images?.jpg?.image_url,
      seiyuu: (c.voice_actors ?? []).find((v) => v.language === 'Japanese')?.person?.name ?? null,
      seiyuuImage: (c.voice_actors ?? []).find((v) => v.language === 'Japanese')?.person?.images?.jpg?.image_url ?? null,
      description: null,
    }));
  }

  console.log('  [fallback] usando AniList para personajes');
  const data = await anilistQuery(`
    query($search: String) {
      Media(search: $search, type: ANIME) {
        characters(perPage: 25, sort: [ROLE, RELEVANCE]) {
          edges {
            role
            voiceActors(language: JAPANESE) { name { full } image { large } }
            node { id name { full native } image { large } description }
          }
        }
      }
    }
  `, { search: ANIME_TITLE });

  return data.Media.characters.edges.map((e) => ({
    source: 'anilist',
    id: e.node.id,
    name: e.node.name.full,
    nameNative: e.node.name.native,
    role: e.role,
    image: e.node.image?.large,
    seiyuu: e.voiceActors?.[0]?.name?.full ?? null,
    seiyuuImage: e.voiceActors?.[0]?.image?.large ?? null,
    description: e.node.description?.replace(/<br\s*\/?>/g, '\n').replace(/~![\s\S]*?!~/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/<[^>]+>/g, ''),
  }));
}

async function fetchEpisodes(animeInfo) {
  console.log('-> Descargando episodios...');
  const malId = await findJikanAnimeId();
  const episodes = [];

  if (malId) {
    let page = 1;
    let hasNext = true;
    while (hasNext) {
      const res = await jikanGet(`/anime/${malId}/episodes?page=${page}`);
      if (!res?.data) break;
      for (const ep of res.data) {
        episodes.push({
          source: 'jikan',
          number: ep.mal_id,
          title: ep.title,
          titleJapanese: ep.title_japanese ?? null,
          titleRomaji: ep.title_romanji ?? null,
          aired: ep.aired,
        });
      }
      hasNext = Boolean(res.pagination?.has_next_page);
      page += 1;
    }
  }

  if (episodes.length) return episodes;

  console.log('  [fallback] generando lista de episodios a partir de datos de AniList (sin titulos individuales disponibles vía API sin autenticacion)');
  const total = animeInfo.episodes ?? 45;
  const from = animeInfo.aired?.from ? new Date(animeInfo.aired.from) : null;
  const to = animeInfo.aired?.to ? new Date(animeInfo.aired.to) : null;
  const spanMs = from && to ? to.getTime() - from.getTime() : null;

  return Array.from({ length: total }, (_, i) => {
    let aired = null;
    if (from && spanMs) {
      const t = new Date(from.getTime() + (spanMs * i) / Math.max(total - 1, 1));
      aired = t.toISOString().slice(0, 10);
    }
    return {
      source: 'anilist-estimate',
      number: i + 1,
      title: `Episodio ${i + 1}`,
      titleJapanese: null,
      titleRomaji: null,
      aired,
    };
  });
}

async function fetchGallery(animeInfo, mangaInfo, characters) {
  console.log('-> Construyendo galeria de imagenes...');
  const images = [];
  if (animeInfo.image) images.push({ url: animeInfo.image, caption: `${animeInfo.title} — portada del anime` });
  if (animeInfo.banner) images.push({ url: animeInfo.banner, caption: `${animeInfo.title} — banner` });
  if (mangaInfo.image) images.push({ url: mangaInfo.image, caption: `${mangaInfo.title} — portada del manga` });
  for (const c of characters) {
    if (c.image) images.push({ url: c.image, caption: c.name });
  }

  const malId = await findJikanAnimeId();
  const pics = malId ? await jikanGet(`/anime/${malId}/pictures`) : null;
  if (pics?.data?.length) {
    for (const p of pics.data) {
      const url = p.jpg?.large_image_url ?? p.jpg?.image_url;
      if (url) images.push({ url, caption: `${animeInfo.title} — imagen` });
    }
  }

  return images;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const animeInfo = await fetchAnimeInfo();
  const mangaInfo = await fetchMangaInfo();
  const characters = await fetchCharacters();
  const episodes = await fetchEpisodes(animeInfo);
  const gallery = await fetchGallery(animeInfo, mangaInfo, characters);

  await writeFile(path.join(DATA_DIR, 'anime.json'), JSON.stringify(animeInfo, null, 2));
  await writeFile(path.join(DATA_DIR, 'manga.json'), JSON.stringify(mangaInfo, null, 2));
  await writeFile(path.join(DATA_DIR, 'characters.json'), JSON.stringify(characters, null, 2));
  await writeFile(path.join(DATA_DIR, 'episodes.json'), JSON.stringify(episodes, null, 2));
  await writeFile(path.join(DATA_DIR, 'gallery.json'), JSON.stringify(gallery, null, 2));

  console.log(`\nListo. Personajes: ${characters.length}, Episodios: ${episodes.length}, Imagenes galeria: ${gallery.length}`);
}

main().catch((err) => {
  console.error('Error al descargar datos:', err);
  process.exit(1);
});
