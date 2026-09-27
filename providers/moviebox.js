// MovieBox Provider for Nuvio Local Scrapers
// Uses public MovieBox H5 API endpoints

// Constants
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const MOVIEBOX_API_BASE = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://moviebox.ph',
    'Referer': 'https://moviebox.ph/'
};

/**
 * Safe fetch wrapper that handles non-2xx responses and malformed JSON
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<object|null>} Parsed JSON or null on failure
 */
async function safeFetch(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...DEFAULT_HEADERS,
                ...(options.headers || {})
            }
        });

        if (!response.ok) {
            console.log(`[MovieBox] HTTP ${response.status} for ${url}`);
            return null;
        }

        const text = await response.text();
        if (!text || text.trim() === '') {
            console.log(`[MovieBox] Empty response for ${url}`);
            return null;
        }

        try {
            return JSON.parse(text);
        } catch (parseError) {
            console.log(`[MovieBox] JSON parse error for ${url}: ${parseError.message}`);
            return null;
        }
    } catch (error) {
        console.log(`[MovieBox] Fetch error for ${url}: ${error.message}`);
        return null;
    }
}

/**
 * Get movie/TV show details from TMDB
 * @param {string} tmdbId - TMDB ID
 * @param {string} mediaType - "movie" or "tv"
 * @returns {Promise<object|null>} Media info or null on failure
 */
async function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    console.log(`[MovieBox] Fetching TMDB details for ${mediaType} ID: ${tmdbId}`);

    const data = await safeFetch(url, { method: 'GET' });
    if (!data) {
        return null;
    }

    const title = mediaType === 'tv' ? data.name : data.title;
    const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
    const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;

    console.log(`[MovieBox] TMDB Info: "${title}" (${releaseYear || 'N/A'})`);

    return {
        title: title,
        releaseYear: releaseYear
    };
}

/**
 * Search for media on MovieBox
 * @param {string} title - Media title
 * @param {string} mediaType - "movie" or "tv"
 * @returns {Promise<object|null>} Matched media item or null
 */
async function searchMovieBox(title, mediaType) {
    const searchUrl = `${MOVIEBOX_API_BASE}/web/subject/search`;
    const subjectType = mediaType === 'tv' ? 1 : 0; // 0 = movie, 1 = tv

    const searchBody = {
        keyword: title,
        page: 1,
        perPage: 20,
        subjectType: subjectType
    };

    console.log(`[MovieBox] Searching for: ${title} (type: ${mediaType})`);

    const data = await safeFetch(searchUrl, {
        method: 'POST',
        body: JSON.stringify(searchBody)
    });

    if (!data || !data.data || !data.data.items || data.data.items.length === 0) {
        console.log(`[MovieBox] No search results for: ${title}`);
        return null;
    }

    const items = data.data.items;

    // Priority 1: Exact title match (case insensitive)
    let matchedMedia = items.find(item =>
        (item.title || '').toLowerCase() === title.toLowerCase()
    );

    // Priority 2: Title contains keyword (fuzzy)
    if (!matchedMedia) {
        matchedMedia = items.find(item =>
            (item.title || '').toLowerCase().includes(title.toLowerCase())
        );
    }

    // Priority 3: First result as fallback
    if (!matchedMedia && items.length > 0) {
        matchedMedia = items[0];
    }

    if (!matchedMedia) {
        console.log(`[MovieBox] Failed to match media for: ${title}`);
        return null;
    }

    console.log(`[MovieBox] Matched: ${matchedMedia.title} (subjectId: ${matchedMedia.subjectId})`);
    return matchedMedia;
}

/**
 * Get play links from MovieBox
 * @param {string} subjectId - MovieBox subject ID
 * @param {number} seasonNum - Season number (0 for movies)
 * @param {number} episodeNum - Episode number (0 for movies)
 * @param {string} detailPath - Detail path for referer
 * @param {string} mediaType - "movie" or "tv"
 * @returns {Promise<Array>} Array of stream sources
 */
async function getPlayLinks(subjectId, seasonNum, episodeNum, detailPath, mediaType) {
    const se = seasonNum || 0;
    const ep = episodeNum || 0;

    const playUrl = `${MOVIEBOX_API_BASE}/web/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}`;

    // Build referer URL
    const referer = `https://moviebox.ph/spa/videoPlayPage/${mediaType === 'tv' ? 'series' : 'movies'}/${detailPath}?id=${subjectId}&type=/${mediaType === 'tv' ? 'series' : 'movie'}/detail&lang=en`;

    console.log(`[MovieBox] Fetching play links for subjectId: ${subjectId}, S${se}E${ep}`);

    const data = await safeFetch(playUrl, {
        method: 'GET',
        headers: { 'Referer': referer }
    });

    if (!data || !data.data || !data.data.streams || !Array.isArray(data.data.streams)) {
        console.log(`[MovieBox] No streams found for subjectId: ${subjectId}`);
        return [];
    }

    return data.data.streams;
}

/**
 * Get captions/subtitles from MovieBox
 * @param {string} subjectId - MovieBox subject ID
 * @param {number} seasonNum - Season number (0 for movies)
 * @param {number} episodeNum - Episode number (0 for movies)
 * @returns {Promise<Array>} Array of caption objects
 */
async function getCaptions(subjectId, seasonNum, episodeNum) {
    const se = seasonNum || 0;
    const ep = episodeNum || 0;

    const captionUrl = `${MOVIEBOX_API_BASE}/web/subject/caption?subjectId=${subjectId}&se=${se}&ep=${ep}`;

    console.log(`[MovieBox] Fetching captions for subjectId: ${subjectId}, S${se}E${ep}`);

    const data = await safeFetch(captionUrl, { method: 'GET' });

    if (!data || !data.data || !data.data.captions || !Array.isArray(data.data.captions)) {
        return [];
    }

    return data.data.captions;
}

/**
 * Normalize stream sources to Nuvio format
 * @param {Array} sources - Raw stream sources from MovieBox
 * @param {string} referer - Referer header value
 * @param {Array} captions - Caption/subtitle tracks
 * @param {string} mediaTitle - Media title for stream naming
 * @returns {Array} Normalized stream objects
 */
function normalizeStreams(sources, referer, captions, mediaTitle) {
    const streams = [];

    for (const source of sources) {
        if (!source.url) continue;

        const quality = source.resolution || source.quality || source.label || 'Auto';

        const stream = {
            name: `MovieBox ${quality}`,
            title: mediaTitle,
            url: source.url,
            quality: quality,
            headers: {
                'Referer': referer,
                'User-Agent': USER_AGENT
            },
            provider: 'moviebox'
        };

        // Attach captions if available
        if (captions && captions.length > 0) {
            stream.subtitles = captions.map(cap => ({
                url: cap.url,
                lang: cap.lang || cap.language || 'unknown',
                label: cap.label || cap.lang || 'Subtitle'
            })).filter(sub => sub.url);
        }

        streams.push(stream);
    }

    // Reverse to put higher quality first (if API returns lowest first)
    return streams.reverse();
}

/**
 * Main scraping function
 * @param {string} tmdbId - TMDB ID
 * @param {string} mediaType - "movie" or "tv"
 * @param {number} seasonNum - Season number (TV only)
 * @param {number} episodeNum - Episode number (TV only)
 * @returns {Promise<Array>} Array of normalized stream objects
 */
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[MovieBox] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);

    try {
        // 1. Get TMDB details
        const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
        if (!mediaInfo || !mediaInfo.title) {
            console.log('[MovieBox] Could not get TMDB details');
            return [];
        }

        const { title, releaseYear } = mediaInfo;

        // 2. Search MovieBox
        const matchedMedia = await searchMovieBox(title, mediaType);
        if (!matchedMedia) {
            console.log('[MovieBox] No match found on MovieBox');
            return [];
        }

        const subjectId = matchedMedia.subjectId;
        const detailPath = matchedMedia.detailPath || matchedMedia.path || '';

        // 3. Get play links
        const sources = await getPlayLinks(subjectId, seasonNum, episodeNum, detailPath, mediaType);
        if (sources.length === 0) {
            console.log('[MovieBox] No playable sources');
            return [];
        }

        // 4. Get captions (optional, non-blocking)
        let captions = [];
        try {
            captions = await getCaptions(subjectId, seasonNum, episodeNum);
        } catch (captionError) {
            console.log(`[MovieBox] Caption fetch failed (non-fatal): ${captionError.message}`);
        }

        // 5. Build referer for streams
        const referer = `https://moviebox.ph/spa/videoPlayPage/${mediaType === 'tv' ? 'series' : 'movies'}/${detailPath}?id=${subjectId}&type=/${mediaType === 'tv' ? 'series' : 'movie'}/detail&lang=en`;

        // 6. Build media title for display
        let mediaTitle = title;
        if (mediaType === 'tv' && seasonNum && episodeNum) {
            mediaTitle = `${title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
        } else if (releaseYear) {
            mediaTitle = `${title} (${releaseYear})`;
        }

        // 7. Normalize and return streams
        const streams = normalizeStreams(sources, referer, captions, mediaTitle);

        console.log(`[MovieBox] Found ${streams.length} streams`);
        return streams;

    } catch (error) {
        console.error(`[MovieBox] Scraping error: ${error.message}`);
        return [];
    }
}

// Export for Node.js / CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native / global environment
    global.MovieBoxScraperModule = { getStreams };
}