// VAPlayer Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach

// Constants
const BASE_URL = 'https://streamdata.vaplayer.ru';
const API_ENDPOINT = '/api.php';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // Same key used by other providers
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const REFERER_ORIGIN = 'https://nextgencloudfabric.com';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'Referer': REFERER_ORIGIN + '/',
    'Origin': REFERER_ORIGIN,
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
};

/**
 * Get movie/TV show details from TMDB including IMDb ID
 */
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    console.log(`[VAPlayer] Fetching TMDB details for ${mediaType} ID: ${tmdbId}`);

    return fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json'
        }
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }).then(function(data) {
        const title = mediaType === 'tv' ? data.name : data.title;
        const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
        const imdbId = data.imdb_id || null;

        console.log(`[VAPlayer] TMDB Info: "${title}" (${releaseYear || 'N/A'})${imdbId ? ', IMDb: ' + imdbId : ''}`);

        return {
            title: title,
            releaseYear: releaseYear,
            imdbId: imdbId
        };
    }).catch(function(error) {
        console.error(`[VAPlayer] TMDB fetch error: ${error.message}`);
        throw error;
    });
}

/**
 * Build the VAPlayer API query string
 */
function buildApiQuery(imdbId, mediaType, seasonNum, episodeNum) {
    const params = new URLSearchParams();
    params.append('imdb', imdbId);
    params.append('type', mediaType === 'tv' ? 'series' : 'movie');

    if (mediaType === 'tv' && seasonNum && episodeNum) {
        params.append('season', seasonNum);
        params.append('episode', episodeNum);
    }

    return params.toString();
}

/**
 * Normalize quality label from VAPlayer stream data
 */
function normalizeQuality(quality) {
    if (!quality) return 'Auto';

    const q = quality.toLowerCase();
    if (q.includes('2160') || q.includes('4k')) return '4K';
    if (q.includes('1440') || q.includes('2k')) return '1440p';
    if (q.includes('1080')) return '1080p';
    if (q.includes('720')) return '720p';
    if (q.includes('480')) return '480p';
    if (q.includes('360')) return '360p';
    if (q.includes('240')) return '240p';
    if (q.includes('auto')) return 'Auto';

    return quality;
}

/**
 * Extract subtitle tracks from VAPlayer response
 */
function extractSubtitles(defaultSubs) {
    if (!defaultSubs || !Array.isArray(defaultSubs)) return [];

    return defaultSubs.map(function(sub) {
        return {
            url: sub.url || sub.file || '',
            lang: sub.lang || sub.language || 'Unknown',
            label: sub.label || sub.lang || 'Subtitle'
        };
    }).filter(function(sub) {
        return sub.url && sub.url.length > 0;
    });
}

/**
 * Fetch streaming data from VAPlayer API
 */
function fetchStreams(imdbId, mediaType, seasonNum, episodeNum, mediaInfo) {
    const { title, releaseYear } = mediaInfo;
    const queryString = buildApiQuery(imdbId, mediaType, seasonNum, episodeNum);
    const apiUrl = BASE_URL + API_ENDPOINT + '?' + queryString;

    console.log(`[VAPlayer] Fetching streams for ${mediaType}: ${imdbId}${mediaType === 'tv' ? ` S${seasonNum}E${episodeNum}` : ''}`);

    const requestHeaders = {
        'Referer': REFERER_ORIGIN + '/',
        'Origin': REFERER_ORIGIN,
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
    };

    return fetch(apiUrl, {
        method: 'GET',
        headers: requestHeaders
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`VAPlayer API error: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('VAPlayer API returned non-JSON response');
        }

        return response.json();
    }).then(function(data) {
        console.log(`[VAPlayer] API response received, status_code: ${data.status_code}`);

        // Handle API-level errors
        if (data.status_code !== 200 && data.status_code !== '200') {
            const msg = data.message || data.error || 'Unknown API error';
            throw new Error(`VAPlayer API error: ${msg}`);
        }

        if (!data.data || !data.data.stream_urls || !Array.isArray(data.data.stream_urls) || data.data.stream_urls.length === 0) {
            console.log('[VAPlayer] No stream URLs found in response');
            return [];
        }

        const subtitles = extractSubtitles(data.data.default_subs);

        // Process stream URLs
        const streams = data.data.stream_urls.map(function(stream, index) {
            if (!stream || !stream.url) return null;

            const quality = normalizeQuality(stream.quality || stream.label || stream.resolution);
            const streamUrl = stream.url;

            // Build media title
            let mediaTitle = title;
            if (mediaType === 'tv' && seasonNum && episodeNum) {
                mediaTitle = `${title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
            } else if (releaseYear) {
                mediaTitle = `${title} (${releaseYear})`;
            }

            const streamObj = {
                name: `VAPlayer - ${quality}`,
                title: mediaTitle,
                url: streamUrl,
                quality: quality,
                size: 'Unknown',
                headers: requestHeaders,
                provider: 'vaplayer'
            };

            // Attach subtitles if available
            if (subtitles.length > 0) {
                streamObj.subtitles = subtitles;
            }

            return streamObj;
        }).filter(Boolean);

        console.log(`[VAPlayer] Found ${streams.length} streams`);

        return streams;
    }).catch(function(error) {
        console.error(`[VAPlayer] Stream fetch error: ${error.message}`);
        throw error;
    });
}

/**
 * Main scraping function
 * @param {string} tmdbId - TMDB ID
 * @param {string} mediaType - "movie" or "tv"
 * @param {number} seasonNum - Season number (TV only)
 * @param {number} episodeNum - Episode number (TV only)
 */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[VAPlayer] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);

    // Get TMDB details first (includes IMDb ID resolution)
    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo.title || !mediaInfo.releaseYear) {
            throw new Error('Could not extract title and release year from TMDB response');
        }

        if (!mediaInfo.imdbId) {
            console.warn('[VAPlayer] No IMDb ID found for this title, VAPlayer requires IMDb ID');
            return [];
        }

        // Fetch streams from VAPlayer API
        return fetchStreams(mediaInfo.imdbId, mediaType, seasonNum, episodeNum, mediaInfo);
    }).catch(function(error) {
        console.error(`[VAPlayer] Scraping error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native environment
    global.VAPlayerScraperModule = { getStreams };
}