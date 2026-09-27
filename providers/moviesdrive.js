// MoviesDrives Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach with cheerio-without-node-native

const cheerio = require('cheerio-without-node-native');

// Constants
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DOMAINS_JSON_URL = 'https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json';
const FALLBACK_DOMAIN = 'https://moviesdrive.design';
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// Global variables for domain caching
let moviesDriveDomain = FALLBACK_DOMAIN;
let gdflixDomain = 'https://new10.gdflix.dad';
let domainCacheTimestamp = 0;

// User Agent
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Working headers for requests
const WORKING_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
};

// Utility Functions

/**
 * Escape regex special characters
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculate similarity between two strings (Levenshtein-based)
 */
function calculateSimilarity(str1, str2) {
    const s1 = normalizeTitle(str1);
    const s2 = normalizeTitle(str2);
    if (s1 === s2) return 1.0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
    if (len2 === 0) return 0.0;
    
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    const maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len1][len2]) / maxLen;
}

/**
 * Find best match from search results
 */
function findBestMatch(query, searchResults) {
    if (!searchResults || searchResults.length === 0) return null;
    if (searchResults.length === 1) return searchResults[0];

    const scored = searchResults.map(r => {
        let score = 0;
        if (normalizeTitle(r.title) === normalizeTitle(query)) score += 100;
        const sim = calculateSimilarity(r.title, query);
        score += sim * 50;
        if (normalizeTitle(r.title).indexOf(normalizeTitle(query)) !== -1) score += 15;
        const lengthDiff = Math.abs(r.title.length - query.length);
        score += Math.max(0, 10 - lengthDiff / 5);
        if (/(19|20)\d{2}/.test(r.title)) score += 5;
        return { item: r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].item;
}

/**
 * Extract quality from text
 */
function extractQuality(text) {
    if (!text) return 'Unknown';
    const match = text.match(/(480p|720p|1080p|2160p|4k)/i);
    return match ? match[1] : 'Unknown';
}

/**
 * Get numeric quality value for sorting
 */
function getIndexQuality(str) {
    if (!str) return 0;
    const match = str.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Get server priority for sorting
 */
function getServerPriority(source) {
    const priorities = {
        'HubCloud': 1,
        'GDFlix': 2,
        'Pixeldrain': 3,
        'GDLink': 4,
        'Unknown': 5
    };
    return priorities[source] || 5;
}

/**
 * Sort streaming links by quality (highest first) and server priority
 */
function sortStreamingLinks(links) {
    return links.sort((a, b) => {
        const qualityA = getIndexQuality(a.quality || a.fileName || a.title);
        const qualityB = getIndexQuality(b.quality || b.fileName || b.title);
        if (qualityA !== qualityB) return qualityB - qualityA;
        const priorityA = getServerPriority(a.source);
        const priorityB = getServerPriority(b.source);
        return priorityA - priorityB;
    });
}

/**
 * ROT13 encoding function
 */
function rot13(str) {
    return (str || '').replace(/[A-Za-z]/g, function(char) {
        const start = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - start + 13) % 26) + start);
    });
}

/**
 * Base64 decode helper (React Native compatible)
 */
function base64Decode(str) {
    try {
        return decodeURIComponent(escape(atob(str)));
    } catch (e) {
        return '';
    }
}

/**
 * Make HTTP request with error handling
 */
async function makeRequest(url, options = {}) {
    const defaultHeaders = { ...WORKING_HEADERS };
    
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: { ...defaultHeaders, ...options.headers },
        redirect: options.followRedirects !== false ? 'follow' : 'manual',
        timeout: options.timeout || 30000
    });

    if (!response.ok && !options.allowNonOk) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (options.parseHTML) {
        const html = await response.text();
        const $ = cheerio.load(html);
        return { $, body: html, statusCode: response.status, headers: Object.fromEntries(response.headers) };
    }

    return { body: await response.text(), statusCode: response.status, headers: Object.fromEntries(response.headers) };
}

/**
 * Fetch and update domain from GitHub JSON
 */
async function fetchAndUpdateDomain() {
    const now = Date.now();
    if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) {
        return;
    }

    try {
        console.log('[MoviesDrives] Fetching latest domains...');
        const response = await fetch(DOMAINS_JSON_URL, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT }
        });

        if (response.ok) {
            const data = await response.json();
            if (data && data.moviesdrive) {
                moviesDriveDomain = data.moviesdrive;
                console.log(`[MoviesDrives] Updated domain to: ${moviesDriveDomain}`);
            }
            if (data && data.gdflix) {
                gdflixDomain = data.gdflix;
                console.log(`[MoviesDrives] Updated GDFlix domain to: ${gdflixDomain}`);
            }
            domainCacheTimestamp = now;
        }
    } catch (error) {
        console.error(`[MoviesDrives] Failed to fetch latest domains: ${error.message}`);
    }
}

/**
 * Get TMDB details for a movie/TV show
 */
async function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    
    console.log(`[MoviesDrives] Fetching TMDB details for ${mediaType} ID: ${tmdbId}`);
    
    try {
        const response = await makeRequest(url);
        const data = JSON.parse(response.body);
        
        const title = mediaType === 'tv' ? data.name : data.title;
        const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
        const year = releaseDate ? releaseDate.split('-')[0] : null;
        const imdbId = data.external_ids?.imdb_id || null;
        
        console.log(`[MoviesDrives] TMDB Info: "${title}" (${year || 'N/A'})`);
        
        return { title, year, imdbId };
    } catch (error) {
        console.error(`[MoviesDrives] TMDB fetch error: ${error.message}`);
        throw error;
    }
}

/**
 * Construct search query from metadata
 */
function constructSearchQuery(metadata, mediaType, seasonNum, episodeNum) {
    if (!metadata || !metadata.title) return null;
    
    let query = metadata.title;
    
    // Add year for movies only
    if (mediaType === 'movie' && metadata.year) {
        query += ` ${metadata.year}`;
    }
    
    // Add season/episode for TV
    if (mediaType === 'tv' && seasonNum && episodeNum) {
        const seasonStr = String(seasonNum).padStart(2, '0');
        const episodeStr = String(episodeNum).padStart(2, '0');
        query += ` S${seasonStr}E${episodeStr}`;
    }
    
    return query;
}

/**
 * Search for content on MoviesDrives
 */
async function searchMoviesDrives(query) {
    try {
        await fetchAndUpdateDomain();
        const searchResults = [];
        const maxPages = 7;
        
        for (let page = 1; page <= maxPages; page++) {
            const searchUrl = `${moviesDriveDomain}/page/${page}/?s=${encodeURIComponent(query)}`;
            console.log(`[MoviesDrives] Searching page ${page}: ${searchUrl}`);
            
            const response = await makeRequest(searchUrl, { parseHTML: true });
            const $ = response.$;
            
            const movieElements = $('ul.recent-movies > li');
            
            if (movieElements.length === 0) {
                console.log(`[MoviesDrives] No more results on page ${page}`);
                break;
            }
            
            movieElements.each((index, element) => {
                const $element = $(element);
                const titleElement = $element.find('figure > img');
                const linkElement = $element.find('figure > a');
                const posterElement = $element.find('figure > img');
                
                if (titleElement.length && linkElement.length) {
                    const title = titleElement.attr('title');
                    const href = linkElement.attr('href');
                    const posterUrl = posterElement.attr('src') || '';
                    
                    if (title && href) {
                        searchResults.push({
                            title: title.replace('Download ', ''),
                            url: href,
                            poster: posterUrl
                        });
                    }
                }
            });
            
            console.log(`[MoviesDrives] Page ${page}: Found ${movieElements.length} results`);
        }
        
        console.log(`[MoviesDrives] Total search results: ${searchResults.length}`);
        return searchResults;
    } catch (error) {
        console.error(`[MoviesDrives] Search error: ${error.message}`);
        return [];
    }
}

/**
 * Extract download page links from movie/show page
 */
async function extractDownloadLinks(pageUrl) {
    try {
        console.log(`[MoviesDrives] Extracting download links from: ${pageUrl}`);
        const response = await makeRequest(pageUrl, { parseHTML: true });
        const $ = response.$;
        
        const downloadLinks = [];
        const buttons = $('h5 > a');
        
        buttons.each((index, button) => {
            const $button = $(button);
            const buttonText = $button.text() || '';
            if (!buttonText.toLowerCase().includes('zip')) {
                const href = $button.attr('href');
                if (href) {
                    downloadLinks.push(href);
                }
            }
        });
        
        console.log(`[MoviesDrives] Found ${downloadLinks.length} download page links`);
        return downloadLinks;
    } catch (error) {
        console.error(`[MoviesDrives] Error extracting download links: ${error.message}`);
        return [];
    }
}

/**
 * Extract HubCloud links (with ROT13+atob decryption)
 */
async function extractHubCloudLinks(url, title, episodeInfo = null) {
    try {
        // Normalize to hubcloud.one
        const normalizedUrl = url.replace(/https:\/\/hubcloud\.[^/]+/, 'https://hubcloud.one');
        
        console.log(`[MoviesDrives] Extracting HubCloud links from: ${normalizedUrl}`);
        
        const response = await makeRequest(normalizedUrl, { parseHTML: true });
        const $ = response.$;
        
        let link = '';
        if (normalizedUrl.includes('drive')) {
            // Extract from script tag
            const scriptTags = $('script');
            scriptTags.each((index, script) => {
                if (link) return false;
                const scriptContent = $(script).html() || '';
                const match = scriptContent.match(/var url = '([^']*)'/);
                if (match) {
                    link = match[1];
                    return false;
                }
            });
        } else {
            // Extract from div.vd > center > a
            const linkElement = $('div.vd > center > a');
            if (linkElement.length) {
                link = linkElement.attr('href') || '';
            }
        }
        
        if (!link.startsWith('https://')) {
            link = 'https://hubcloud.one' + link;
        }
        
        if (!link) {
            console.log('[MoviesDrives] No HubCloud link found');
            return [];
        }
        
        // Get the final download page
        const finalResponse = await makeRequest(link, { parseHTML: true });
        const final$ = finalResponse.$;
        
        const header = final$('div.card-header');
        const headerText = header.length ? header.text() : '';
        const sizeElement = final$('i#size');
        const size = sizeElement.length ? sizeElement.text() : '';
        
        const downloadButtons = final$('div.card-body h2 a.btn');
        const finalLinks = [];
        
        for (let i = 0; i < downloadButtons.length; i++) {
            const $button = final$(downloadButtons[i]);
            const buttonHref = $button.attr('href');
            const buttonText = $button.text() || '';
            
            const processButton = (finalUrl, sourceName) => {
                if (finalUrl) {
                    const quality = extractQuality(headerText);
                    finalLinks.push({
                        url: finalUrl,
                        source: sourceName || 'HubCloud',
                        title: title,
                        quality: quality,
                        size: size,
                        fileName: headerText.trim()
                    });
                }
            };
            
            if (buttonText.includes('Download [FSL Server]')) {
                processButton(buttonHref, 'HubCloud[FSL Server]');
            } else if (buttonText.includes('Download File')) {
                processButton(buttonHref, 'HubCloud');
            } else if (buttonText.includes('BuzzServer')) {
                // Follow redirect for BuzzServer
                const downloadUrl = buttonHref + '/download';
                try {
                    const redirectResponse = await makeRequest(downloadUrl, { followRedirects: false });
                    if (redirectResponse.headers && redirectResponse.headers['hx-redirect']) {
                        const baseUrl = new URL(buttonHref).origin;
                        const redirectPath = redirectResponse.headers['hx-redirect'];
                        processButton(baseUrl + redirectPath, 'HubCloud[BuzzServer]');
                    } else {
                        processButton(buttonHref, 'HubCloud[BuzzServer]');
                    }
                } catch (e) {
                    processButton(buttonHref, 'HubCloud[BuzzServer]');
                }
            } else if (buttonHref.includes('pixeldra')) {
                // Convert Pixeldrain URL to API format
                let finalPixeldrainUrl = buttonHref;
                if (buttonHref && buttonHref.includes('/u/')) {
                    const fileId = buttonHref.split('/u/')[1].split('?')[0];
                    finalPixeldrainUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
                }
                processButton(finalPixeldrainUrl, 'Pixeldrain');
            } else if (buttonText.includes('Download [Server : 10Gbps]')) {
                // Skip HubCloud [Download] links
            }
        }
        
        // Filter for specific episode if requested
        let filteredLinks = finalLinks;
        if (episodeInfo && episodeInfo.isEpisode) {
            filteredLinks = finalLinks.filter(link => matchesEpisode(link.fileName || link.title || '', episodeInfo));
        }
        
        console.log(`[MoviesDrives] Extracted ${filteredLinks.length} HubCloud links`);
        return filteredLinks;
    } catch (error) {
        console.error(`[MoviesDrives] HubCloud extraction error: ${error.message}`);
        return [];
    }
}

/**
 * Extract GDFlix links
 */
async function extractGDFlixLinks(url, title, episodeInfo = null) {
    try {
        await fetchAndUpdateDomain();
        
        // Rewrite URL to current GDFlix domain
        const newUrl = url
            .replace(/https:\/\/[^.]+\.gdflix\.[^/]+/, gdflixDomain)
            .replace(/https:\/\/gdlink\.[^/]+/, gdflixDomain);
        
        console.log(`[MoviesDrives] Extracting GDFlix links from: ${newUrl}`);
        
        const response = await makeRequest(newUrl, { parseHTML: true });
        const $ = response.$;
        
        let fileName = '';
        let fileSize = '';
        
        const listItems = $('ul > li.list-group-item');
        listItems.each((index, item) => {
            const text = $(item).text() || '';
            if (text.includes('Name :')) {
                fileName = text.replace('Name :', '').trim();
            } else if (text.includes('Size :')) {
                fileSize = text.replace('Size :', '').trim();
            }
        });
        
        const downloadButtons = $('div.text-center a');
        const finalLinks = [];
        
        for (let i = 0; i < downloadButtons.length; i++) {
            const $button = $(downloadButtons[i]);
            const buttonHref = $button.attr('href');
            const buttonText = $button.text() || '';
            
            const processButton = (finalUrl, sourceName) => {
                if (finalUrl) {
                    finalLinks.push({
                        url: finalUrl,
                        source: sourceName || 'GDFlix',
                        title: title,
                        quality: extractQuality(fileName),
                        size: fileSize,
                        fileName: fileName
                    });
                }
            };
            
            if (buttonText.includes('DIRECT DL')) {
                processButton(buttonHref, 'GDFlix[Direct]');
            } else if (buttonText.includes('CLOUD DOWNLOAD [R2]')) {
                processButton(buttonHref, 'GDFlix[Cloud Download]');
            } else if (buttonText.includes('PixelDrain DL')) {
                let finalPixeldrainUrl = buttonHref;
                if (buttonHref && buttonHref.includes('/u/')) {
                    const fileId = buttonHref.split('/u/')[1].split('?')[0];
                    finalPixeldrainUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
                }
                processButton(finalPixeldrainUrl, 'Pixeldrain');
            } else if (buttonText.includes('Instant DL')) {
                // Handle Instant DL - follow redirect
                try {
                    const redirectResponse = await makeRequest(buttonHref, { followRedirects: false });
                    if (redirectResponse.headers && redirectResponse.headers.location) {
                        const location = redirectResponse.headers.location;
                        const finalUrl = location.includes('url=') 
                            ? location.substring(location.indexOf('url=') + 4) 
                            : location;
                        processButton(finalUrl, 'GDFlix[Instant Download]');
                    } else {
                        processButton(buttonHref, 'GDFlix[Instant Download]');
                    }
                } catch (e) {
                    processButton(buttonHref, 'GDFlix[Instant Download]');
                }
            }
        }
        
        // Filter for specific episode if requested
        let filteredLinks = finalLinks;
        if (episodeInfo && episodeInfo.isEpisode) {
            filteredLinks = finalLinks.filter(link => matchesEpisode(link.fileName || link.title || '', episodeInfo));
        }
        
        console.log(`[MoviesDrives] Extracted ${filteredLinks.length} GDFlix links`);
        return filteredLinks;
    } catch (error) {
        console.error(`[MoviesDrives] GDFlix extraction error: ${error.message}`);
        return [];
    }
}

/**
 * Detect episode pattern in query
 */
function detectEpisodePattern(query) {
    const episodePatterns = [
        /S(\d{1,2})E(\d{1,2})/i,
        /Season\s*(\d{1,2})\s*Episode\s*(\d{1,2})/i,
        /(\d{1,2})x(\d{1,2})/i
    ];

    for (const pattern of episodePatterns) {
        const match = query.match(pattern);
        if (match) {
            return {
                isEpisode: true,
                season: parseInt(match[1]),
                episode: parseInt(match[2])
            };
        }
    }
    return { isEpisode: false };
}

/**
 * Check if filename matches episode pattern
 */
function matchesEpisode(filename, episodeInfo) {
    if (!episodeInfo.isEpisode) return true;
    
    const season = episodeInfo.season.toString().padStart(2, '0');
    const episode = episodeInfo.episode.toString().padStart(2, '0');
    
    const patterns = [
        new RegExp(`S${season}E${episode}`, 'i'),
        new RegExp(`S${episodeInfo.season}E${episodeInfo.episode}`, 'i'),
        new RegExp(`S${season}\\.E${episode}`, 'i'),
        new RegExp(`S${episodeInfo.season}\\.E${episodeInfo.episode}`, 'i'),
        new RegExp(`Season\\s*${episodeInfo.season}.*Episode\\s*${episodeInfo.episode}`, 'i'),
        new RegExp(`${episodeInfo.season}x${episode}`, 'i')
    ];
    
    return patterns.some(pattern => pattern.test(filename));
}

/**
 * Process download page links to extract streaming links
 */
async function processDownloadLinks(downloadLinks, episodeInfo = null) {
    const allStreamingLinks = [];
    
    for (const downloadLink of downloadLinks) {
        try {
            const response = await makeRequest(downloadLink, { parseHTML: true });
            const $ = response.$;
            
            // Look for streaming links (HubCloud, GDFlix, GDLink)
            const streamingElements = $('a');
            const intermediateLinks = [];
            
            streamingElements.each((index, element) => {
                const $element = $(element);
                const href = $element.attr('href') || '';
                const text = $element.text() || '';
                
                if (href && (href.toLowerCase().includes('hubcloud') ||
                    href.toLowerCase().includes('gdflix') ||
                    href.toLowerCase().includes('gdlink'))) {
                    
                    let source = 'Unknown';
                    if (text.toLowerCase().includes('hubcloud') || href.toLowerCase().includes('hubcloud')) {
                        source = 'HubCloud';
                    } else if (text.toLowerCase().includes('gdflix') || href.toLowerCase().includes('gdflix')) {
                        source = 'GDFlix';
                    } else if (text.toLowerCase().includes('gdlink') || href.toLowerCase().includes('gdlink')) {
                        source = 'GDLink';
                    }
                    
                    intermediateLinks.push({ url: href, source });
                }
            });
            
            // Extract final URLs from each intermediate link
            for (const intermediate of intermediateLinks) {
                if (intermediate.source === 'HubCloud') {
                    const links = await extractHubCloudLinks(intermediate.url, '', episodeInfo);
                    allStreamingLinks.push(...links);
                } else if (intermediate.source === 'GDFlix' || intermediate.source === 'GDLink') {
                    const links = await extractGDFlixLinks(intermediate.url, '', episodeInfo);
                    allStreamingLinks.push(...links);
                }
            }
        } catch (error) {
            console.error(`[MoviesDrives] Error processing download link ${downloadLink}: ${error.message}`);
        }
    }
    
    return allStreamingLinks;
}

/**
 * Convert MoviesDrives links to Nuvio stream format
 */
function convertToNuvioFormat(links) {
    const streams = links.map(link => {
        let quality = 'Unknown';
        if (link.quality && link.quality !== 'Unknown') {
            quality = link.quality;
        } else if (link.fileName) {
            const qualityMatch = link.fileName.match(/(\d{3,4})[pP]/);
            if (qualityMatch) {
                quality = qualityMatch[1] + 'p';
            }
        }
        
        let name = 'MoviesDrives';
        if (link.source && link.source !== 'Unknown') {
            name += ` (${link.source})`;
        }
        if (quality !== 'Unknown') {
            name += ` - ${quality}`;
        }
        
        let streamTitle = link.title || 'MoviesDrives Stream';
        if (link.size && link.size !== 'Unknown') {
            streamTitle += `\n${link.size}`;
        }
        if (link.fileName) {
            streamTitle += `\n${link.fileName}`;
        }
        
        return {
            name: name,
            title: streamTitle,
            url: link.url,
            quality: quality,
            size: link.size || 'Unknown',
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': moviesDriveDomain + '/'
            },
            provider: 'moviesdrive'
        };
    });
    
    // Remove duplicates based on URL
    const uniqueStreams = [];
    const seenUrls = new Set();
    for (const stream of streams) {
        if (!seenUrls.has(stream.url)) {
            seenUrls.add(stream.url);
            uniqueStreams.push(stream);
        }
    }
    
    return uniqueStreams;
}

/**
 * Main function to get streams for TMDB content
 */
async function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[MoviesDrives] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);
    
    try {
        // 1. Get TMDB metadata
        const metadata = await getTMDBDetails(tmdbId, mediaType);
        if (!metadata || !metadata.title) {
            console.log(`[MoviesDrives] Could not extract title from TMDB response`);
            return [];
        }
        
        // 2. Construct search query
        const searchQuery = constructSearchQuery(metadata, mediaType, seasonNum, episodeNum);
        if (!searchQuery) {
            console.log(`[MoviesDrives] Could not construct search query`);
            return [];
        }
        
        console.log(`[MoviesDrives] Searching for: "${searchQuery}"`);
        
        // 3. Search for content
        const searchResults = await searchMoviesDrives(searchQuery);
        if (searchResults.length === 0) {
            console.log(`[MoviesDrives] No search results found`);
            return [];
        }
        
        // 4. Find best match
        const selectedResult = findBestMatch(searchQuery, searchResults);
        if (!selectedResult) {
            console.log(`[MoviesDrives] No suitable match found`);
            return [];
        }
        
        console.log(`[MoviesDrives] Selected: ${selectedResult.title}`);
        
        // 5. Detect episode pattern for filtering
        const episodeInfo = detectEpisodePattern(searchQuery);
        
        // 6. Extract download page links
        const downloadLinks = await extractDownloadLinks(selectedResult.url);
        if (downloadLinks.length === 0) {
            console.log(`[MoviesDrives] No download pages found`);
            return [];
        }
        
        // 7. Process download links to get final streaming links
        const streamingLinks = await processDownloadLinks(downloadLinks, episodeInfo);
        if (streamingLinks.length === 0) {
            console.log(`[MoviesDrives] No streaming links found`);
            return [];
        }
        
        // 8. Sort by quality and server priority
        const sortedLinks = sortStreamingLinks(streamingLinks);
        
        // 9. Convert to Nuvio format
        const streams = convertToNuvioFormat(sortedLinks);
        
        console.log(`[MoviesDrives] Successfully processed ${streams.length} streams`);
        return streams;
        
    } catch (error) {
        console.error(`[MoviesDrives] Error in getStreams: ${error.message}`);
        return [];
    }
}

// Export for React Native compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}