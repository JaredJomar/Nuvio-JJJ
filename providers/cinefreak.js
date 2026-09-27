// CineFreak Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach

// Constants - Base URL made easily configurable for domain changes
const BASE_URL = 'https://cinefreak.net';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // Same key used by other providers
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': BASE_URL + '/',
    'Origin': BASE_URL
};

// Utility Functions

/**
 * Safe fetch with error handling for non-2xx responses
 */
function safeFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            ...DEFAULT_HEADERS,
            ...options.headers
        }
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    }).catch(function(error) {
        console.error(`[CineFreak] Request failed for ${url}: ${error.message}`);
        throw error;
    });
}

/**
 * Base64 decoding helper (React Native compatible)
 */
function base64Decode(str) {
    try {
        const decoded = atob(str);
        return decodeURIComponent(escape(decoded));
    } catch (error) {
        console.error('[CineFreak] Base64 decode error:', error);
        return '';
    }
}

/**
 * Extract quality label from text
 */
function extractQuality(text) {
    if (!text) return 'Auto';
    
    const lowerText = text.toLowerCase();
    
    // Check for explicit quality labels
    if (lowerText.includes('2160') || lowerText.includes('4k')) return '4K';
    if (lowerText.includes('1440') || lowerText.includes('2k')) return '1440p';
    if (lowerText.includes('1080')) return '1080p';
    if (lowerText.includes('720')) return '720p';
    if (lowerText.includes('480')) return '480p';
    if (lowerText.includes('360')) return '360p';
    if (lowerText.includes('240')) return '240p';
    if (lowerText.includes('auto')) return 'Auto';
    
    // Try to extract from patterns like "1080p", "720P", etc.
    const qualityMatch = text.match(/(\d{3,4})[pP]/);
    if (qualityMatch) {
        const res = parseInt(qualityMatch[1]);
        if (res >= 2160) return '4K';
        if (res >= 1440) return '1440p';
        if (res >= 1080) return '1080p';
        if (res >= 720) return '720p';
        if (res >= 480) return '480p';
        if (res >= 360) return '360p';
        return '240p';
    }
    
    return 'Auto';
}

/**
 * Get movie/TV show details from TMDB
 */
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    console.log(`[CineFreak] Fetching TMDB details for ${mediaType} ID: ${tmdbId}`);
    
    return safeFetch(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        const title = mediaType === 'tv' ? data.name : data.title;
        const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
        const imdbId = data.imdb_id || null;
        
        console.log(`[CineFreak] TMDB Info: "${title}" (${releaseYear || 'N/A'})`);
        
        return {
            title: title,
            releaseYear: releaseYear,
            imdbId: imdbId
        };
    }).catch(function(error) {
        console.error(`[CineFreak] TMDB fetch error: ${error.message}`);
        throw error;
    });
}

/**
 * Search for content on CineFreak using the public search API
 * Expected response shape: array of objects with title and link properties,
 * or { results: [...] } wrapper
 */
function searchCineFreak(query, mediaType) {
    const searchUrl = `${BASE_URL}/search-api.php?q=${encodeURIComponent(query)}`;
    
    console.log(`[CineFreak] Searching for: "${query}" at ${searchUrl}`);
    
    return safeFetch(searchUrl).then(function(response) {
        return response.json();
    }).then(function(data) {
        // Accept both bare array and { results: [...] } wrapper
        let results = [];
        if (Array.isArray(data)) {
            results = data;
        } else if (data && Array.isArray(data.results)) {
            results = data.results;
        } else {
            console.log('[CineFreak] Invalid search response format');
            return [];
        }
        
        console.log(`[CineFreak] Found ${results.length} search results`);
        
        // Filter and map results conservatively
        return results
            .filter(function(item) {
                // Only keep items with required fields
                return item && typeof item.title === 'string' && typeof item.link === 'string';
            })
            .map(function(item) {
                return {
                    title: item.title,
                    link: item.link
                };
            });
    }).catch(function(error) {
        console.error(`[CineFreak] Search error: ${error.message}`);
        return [];
    });
}

/**
 * Find best match from search results
 */
function findBestMatch(results, targetTitle, targetYear, mediaType) {
    if (!results || results.length === 0) return null;
    
    const targetLower = targetTitle.toLowerCase();
    const targetYearStr = targetYear ? targetYear.toString() : '';
    
    // Score each result
    const scored = results.map(function(result) {
        const resultTitle = result.title || '';
        const resultLower = resultTitle.toLowerCase();
        let score = 0;
        
        // Exact title match (case insensitive)
        if (resultLower === targetLower) score += 100;
        
        // Title contains target or vice versa
        if (resultLower.includes(targetLower) || targetLower.includes(resultLower)) score += 50;
        
        // Year match in title
        if (targetYearStr && resultTitle.includes(targetYearStr)) score += 30;
        
        // Media type hint in URL (movie vs series)
        if (mediaType === 'movie' && result.link.includes('/movie/')) score += 20;
        if (mediaType === 'tv' && (result.link.includes('/series/') || result.link.includes('/tv/'))) score += 20;
        
        // Prefer shorter titles (less likely to be collections)
        score += Math.max(0, 20 - resultTitle.length / 5);
        
        return { item: result, score: score };
    });
    
    // Sort by score descending
    scored.sort(function(a, b) { return b.score - a.score; });
    
    console.log(`[CineFreak] Best match: "${scored[0].item.title}" (score: ${scored[0].score})`);
    return scored[0].item;
}

/**
 * Fetch the media page to extract download/generate links
 */
function fetchMediaPage(url) {
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? url : '/' + url}`;
    
    console.log(`[CineFreak] Fetching media page: ${fullUrl}`);
    
    return safeFetch(fullUrl, {
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    }).then(function(response) {
        return response.text();
    }).catch(function(error) {
        console.error(`[CineFreak] Media page fetch error: ${error.message}`);
        throw error;
    });
}

/**
 * Parse download entries from media page HTML
 * Looks for generate.php?id=<base64> patterns and associated quality labels
 */
function parseDownloadEntries(html, mediaType, seasonNum, episodeNum) {
    const entries = [];
    
    // Pattern 1: Direct generate.php links with base64 IDs
    // <a href="/generate.php?id=BASE64">Quality Label</a>
    const generateRegex = /<a[^>]+href=["']([^"']*generate\.php\?id=([^"'>]+))["'][^>]*>([^<]*)<\/a>/gi;
    let match;
    
    while ((match = generateRegex.exec(html)) !== null) {
        const fullHref = match[1];
        const base64Id = match[2];
        const label = match[3] || '';
        
        // Decode the base64 ID to get the actual redirect URL
        const decodedUrl = base64Decode(base64Id);
        
        if (decodedUrl && (decodedUrl.startsWith('http') || decodedUrl.startsWith('/'))) {
            const quality = extractQuality(label);
            entries.push({
                url: decodedUrl.startsWith('http') ? decodedUrl : `${BASE_URL}${decodedUrl}`,
                quality: quality,
                label: label.trim(),
                source: 'generate'
            });
        }
    }
    
    // Pattern 2: Direct download/stream links with quality in text
    // <a href="STREAM_URL">Quality Label</a>
    const directRegex = /<a[^>]+href=["'](https?:\/\/[^"']+\.(?:m3u8|mp4|mkv|avi|mov)[^"']*)["'][^>]*>([^<]*)<\/a>/gi;
    
    while ((match = directRegex.exec(html)) !== null) {
        const streamUrl = match[1];
        const label = match[2] || '';
        const quality = extractQuality(label);
        
        entries.push({
            url: streamUrl,
            quality: quality,
            label: label.trim(),
            source: 'direct'
        });
    }
    
    // Pattern 3: Button/link elements with data attributes for quality
    // <button data-url="..." data-quality="1080p">Download</button>
    const buttonRegex = /<button[^>]+data-url=["']([^"']+)["'][^>]*data-quality=["']([^"']*)["'][^>]*>/gi;
    
    while ((match = buttonRegex.exec(html)) !== null) {
        const streamUrl = match[1];
        const qualityLabel = match[2] || '';
        const quality = extractQuality(qualityLabel);
        
        entries.push({
            url: streamUrl,
            quality: quality,
            label: qualityLabel,
            source: 'button'
        });
    }
    
    // Pattern 4: For TV shows, look for season/episode specific links
    if (mediaType === 'tv' && seasonNum && episodeNum) {
        const seasonEpisodeRegex = new RegExp(
            `<a[^>]+href=["']([^"']*generate\\.php\\?id=([^"'>]+))["'][^>]*>[^<]*S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}[^<]*</a>`, 
            'gi'
        );
        
        while ((match = seasonEpisodeRegex.exec(html)) !== null) {
            const fullHref = match[1];
            const base64Id = match[2];
            const decodedUrl = base64Decode(base64Id);
            
            if (decodedUrl && (decodedUrl.startsWith('http') || decodedUrl.startsWith('/'))) {
                entries.push({
                    url: decodedUrl.startsWith('http') ? decodedUrl : `${BASE_URL}${decodedUrl}`,
                    quality: 'Auto',
                    label: `S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`,
                    source: 'generate'
                });
            }
        }
    }
    
    console.log(`[CineFreak] Parsed ${entries.length} download entries`);
    return entries;
}

/**
 * Resolve generate.php redirect to final stream URL
 */
function resolveGenerateLink(generateUrl) {
    // If it's already a direct stream URL, return as-is
    if (generateUrl.includes('.m3u8') || generateUrl.includes('.mp4') || generateUrl.includes('.mkv')) {
        return Promise.resolve(generateUrl);
    }
    
    // Follow the generate.php redirect
    return safeFetch(generateUrl, {
        method: 'GET',
        redirect: 'manual' // Don't auto-follow to capture final URL
    }).then(function(response) {
        // Check for redirect
        const location = response.headers.get('location');
        if (location && (location.includes('.m3u8') || location.includes('.mp4') || location.includes('.mkv') || location.includes('stream') || location.includes('cdn'))) {
            console.log(`[CineFreak] Resolved redirect to: ${location.substring(0, 80)}...`);
            return location;
        }
        
        // If no redirect header, try to get the response body for embedded URL
        return response.text().then(function(body) {
            // Look for direct stream URLs in response
            const streamMatch = body.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4|mkv)[^"'\s]*)/i);
            if (streamMatch) {
                console.log(`[CineFreak] Found stream in response: ${streamMatch[1].substring(0, 80)}...`);
                return streamMatch[1];
            }
            
            // Return original URL if we can't resolve further
            console.log(`[CineFreak] Could not resolve generate link, using original`);
            return generateUrl;
        });
    }).catch(function(error) {
        console.error(`[CineFreak] Generate link resolution error: ${error.message}`);
        return generateUrl; // Return original on error
    });
}

/**
 * Build stream objects in Nuvio format
 */
function buildStreams(entries, title, releaseYear, mediaType, seasonNum, episodeNum) {
    const streamPromises = entries.map(function(entry) {
        return resolveGenerateLink(entry.url).then(function(finalUrl) {
            // Build media title
            let mediaTitle = title;
            if (releaseYear) mediaTitle += ` (${releaseYear})`;
            if (mediaType === 'tv' && seasonNum && episodeNum) {
                mediaTitle += ` S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
            }
            
            const qualityLabel = entry.quality || 'Auto';
            
            return {
                name: `CineFreak - ${qualityLabel}`,
                title: mediaTitle,
                url: finalUrl,
                quality: qualityLabel,
                size: 'Unknown',
                headers: DEFAULT_HEADERS,
                provider: 'cinefreak'
            };
        }).catch(function(error) {
            console.error(`[CineFreak] Stream build error: ${error.message}`);
            return null;
        });
    });
    
    return Promise.all(streamPromises).then(function(streams) {
        // Filter out null entries and deduplicate by URL
        const validStreams = streams.filter(function(s) { return s && s.url; });
        const uniqueStreams = Array.from(new Map(validStreams.map(s => [s.url, s])).values());
        
        // Sort by quality (highest first)
        const qualityOrder = { '4K': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0, '240p': -1, 'Auto': -2 };
        uniqueStreams.sort(function(a, b) {
            return (qualityOrder[b.quality] || -2) - (qualityOrder[a.quality] || -2);
        });
        
        console.log(`[CineFreak] Built ${uniqueStreams.length} unique streams`);
        return uniqueStreams;
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
    console.log(`[CineFreak] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);
    
    // Get TMDB details first
    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo.title || !mediaInfo.releaseYear) {
            throw new Error('Could not extract title and release year from TMDB response');
        }
        
        const { title, releaseYear } = mediaInfo;
        
        // Search for content on CineFreak
        return searchCineFreak(title, mediaType).then(function(searchResults) {
            if (searchResults.length === 0) {
                console.log('[CineFreak] No search results found');
                return [];
            }
            
            // Find best match
            const bestMatch = findBestMatch(searchResults, title, releaseYear, mediaType);
            if (!bestMatch) {
                console.log('[CineFreak] No suitable match found');
                return [];
            }
            
            // Fetch media page
            return fetchMediaPage(bestMatch.link).then(function(html) {
                // Parse download entries
                const entries = parseDownloadEntries(html, mediaType, seasonNum, episodeNum);
                
                if (entries.length === 0) {
                    console.log('[CineFreak] No download entries found');
                    return [];
                }
                
                // Build stream objects
                return buildStreams(entries, title, releaseYear, mediaType, seasonNum, episodeNum);
            });
        });
    }).catch(function(error) {
        console.error(`[CineFreak] Scraping error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native environment
    global.CineFreakScraperModule = { getStreams };
}