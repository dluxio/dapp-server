const express = require('express');
const cors = require('cors');
const config = require('./config.js');
const fetch = require('node-fetch');
const sanitizeHtml = require('sanitize-html');
const { marked } = require('marked');

const renderer = { /* ... */ };
marked.use({ renderer });

function cleanDescription(rawContent) {
    let text = marked(rawContent);
    text = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
    return text.replace(/\s+/g, ' ').trim().substring(0, 160);
}

const app = express();
app.use(cors());

app.get('/@:un', (req, res) => {
    //redirect to htps://dlux.io/@:un
    res.redirect(`https://dlux.io/@${req.params.un}`);
});

app.get('/hm', (req, res) => {
    res.json({ uptime: process.uptime() });
});
    
const serviceWorker = (req, res) => {
    const un = req.params.un;
    const permlink = req.params.permlink;
    const protocol = req.protocol;
    const host = req.hostname;
    makeSW(un, permlink, req.params.tag, protocol, host).then((template) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.send(template.js);
    }).catch((e) => {
        console.error(e);
        if (e === "Not Found") {
            res.status(404).send('Not Found');
        } else {
            res.status(500).send('Internal Server Error');
        }
    });
}

const manifest = (req, res) => {
    const un = req.params.un;
    const permlink = req.params.permlink;
    const protocol = req.protocol;
    const host = req.hostname;
    makeManifest(un, permlink, req.params.tag, protocol, host).then((template) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.send(template.js);
    }).catch((e) => {
        console.error(e);
        if (e === "Not Found") {
            res.status(404).send('Not Found');
        } else {
            res.status(500).send('Internal Server Error');
        }
    });
}

const content = (req, res) => {
    const author = req.params.un;
    const permlink = req.params.permlink;
    const dns01 = req.hostname.split('.')[0]
    const authorizedDNS01 = author.split('.').join('--')
    if(dns01 != authorizedDNS01)res.redirect(`https://dlux.io/@${author}/${permlink}`)
    fetch(config.hapi, {
        body: `{"jsonrpc":"2.0", "method":"condenser_api.get_content", "params":["${author}", "${permlink}"], "id":1}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
    })
    .then((response) => response.json())
    .then((content) => {
        const json_metadata = content.result.json_metadata ? JSON.parse(content.result.json_metadata) : {};
        if(json_metadata.dappCID){
            fetch(config.ipfs + '/ipfs/' + json_metadata.dappCID).then((response) => response.text()).then((result) => {
                // insert a script tag to include window messaging to the main website(not the subdomain)
                result = result.replace('</head>', `<script src="https://dlux.io/js/dlux-wallet.js"></script></head>`);
                res.send(result);
            }).catch((e) => res.redirect(`https://dlux.io/@${author}/${permlink}`));
        } else {
            res.redirect(`https://dlux.io/@${author}/${permlink}`)
        }
    }).catch((e) => res.redirect(`https://dlux.io/@${author}/${permlink}`));
}

app.get('/rb', (req, res) => {
    const author = req.params.author;
    const permlink = req.params.permlink;
    const tag = req.params.tag;
    const protocol = req.protocol;
    const host = req.hostname;
    getHiveContent(author, permlink, tag, protocol, host).then((template) => {
        res.send(template.html);
    }).catch((e) => {
        res.status(500).send('Internal Server Error');
    });
})

app.get('/@:un/:permlink/service-worker.js', serviceWorker);
app.get('/@:un/:permlink/manifest.webmanifest', manifest);
app.get('/:tag/@:un/:permlink/service-worker.js', serviceWorker);
app.get('/:tag/@:un/:permlink/manifest.webmanifest', manifest);
app.get('/@:un/:permlink', content);
app.get('/:tag/@:un/:permlink', content);

app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
});

function getHiveContent(un, permlink, str = null, p, h) {
    return new Promise((resolve, reject) => {
        var template = {
            html: `<!DOCTYPE html>
<html>
    <head>
        <title>DLUX | $TITLE</title>
        <meta property="og:type" content="website">
        <meta property="og:url" content="${p}://${h}${str ? `/${str}` : ''}/@${un}/${permlink}">
        <meta property="og:image" content="$IMAGE">
        <meta property="og:title" content="DLUX | $TITLE">
        <meta property="og:description" content="$CONTENT">
        <link rel="canonical" content="${p}://${h}${str ? `/${str}` : ''}/@${un}/${permlink}">
        <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "DLUX | $TITLE",
  "image": "$IMAGE",
  "author": "${un}",
  "description": "$CONTENT"
}
</script>
    </head>
</html>`,
            image: `og:image`,
            description: `og:description`
        };
        fetch(config.hapi, {
            body: `{"jsonrpc":"2.0", "method":"condenser_api.get_content", "params":["${un}", "${permlink}"], "id":1}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            method: "POST",
        })
            .then((response) => response.json())
            .then((res) => {
                if (res.result?.author === un) {
                    const content = res.result;
                    template.title = content.title || 'Untitled';
                    let description = content.body || 'No description available';
                    const json_metadata = content.json_metadata ? JSON.parse(content.json_metadata) : {};
                    description = json_metadata.content?.description ||
                        json_metadata.video?.content?.description ||
                        description;
                    template.description = cleanDescription(description);
                    try {
                        template.image = json_metadata.image?.[0] || `${p}://${h}${config.img}`;
                    } catch (e) {
                        template.image = `${p}://${h}${config.img}`;
                    }
                    template.html = template.html
                        .replace(/\$IMAGE/g, template.image)
                        .replace(/\$CONTENT/g, template.description)
                        .replace(/\$TITLE/g, template.title);
                    resolve(template);
                } else {
                    reject("Not Found");
                }
            }).catch((e) => reject(e));
    });
}


function makeSW(un, permlink, str, p, h) {
    return new Promise((resolve, reject) => {
        var template = {
            js: `const PRECACHE = 'precache-v1';
const RUNTIME = 'runtime';
const PRECACHE_URLS = [$ASSETS];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(PRECACHE)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(self.skipWaiting())
    );
});
self.addEventListener('activate', event => {
    const currentCaches = [PRECACHE, RUNTIME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
        }).then(cachesToDelete => {
            return Promise.all(cachesToDelete.map(cacheToDelete => caches.delete(cacheToDelete)));
        }).then(() => self.clients.claim())
    );
});
self.addEventListener('fetch', event => {
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;
                return caches.open(RUNTIME).then(cache => {
                    return fetch(event.request).then(response => {
                        return cache.put(event.request, response.clone()).then(() => response);
                    });
                });
            })
        );
    }
});`
        };
        fetch(config.hapi, {
            body: `{"jsonrpc":"2.0", "method":"condenser_api.get_content", "params":["${un}", "${permlink}"], "id":1}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            method: "POST",
        })
            .then((response) => response.json())
            .then((res) => {
                if (res.result?.author === un) {
                    try {
                        const metadata = JSON.parse(res.result.json_metadata);
                        if(metadata.enableServiceWorker === false){
                            reject("Not Supported");
                        }
                        if (metadata.sw) {
                            fetch(config.ipfs + metadata.sw).then((response) => response.text()).then((res) => {
                                resolve(res);
                            });
                        } else {
                        const hashy = metadata.dappCID ||metadata.vrHash || metadata.arHash || metadata.appHash || metadata.audHash || '';
                        const precacheUrls = [`/@${un}/${permlink}`, `/ipfs/${hashy}`];
                        if (metadata.assets) {
                            for (const asset of metadata.assets) {
                                if (asset.hash && asset.hash !== hashy) precacheUrls.push(`'/ipfs/${asset.hash}'`);
                            }
                        }
                        if (metadata.morePrecacheUrls) {
                            for (const url of metadata.morePrecacheUrls) {
                                precacheUrls.push(`'${url}'`);
                            }
                        }
                        const assetsString = precacheUrls.join(', ');
                        template.js = template.js.replace("$ASSETS", assetsString);
                        resolve(template);
                    }
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject("Not Found");
                }
            }).catch((e) => reject(e));
    });
}

function makeManifest(un, permlink, str, p, h) {
    return new Promise((resolve, reject) => {
        fetch(config.hapi, {
            body: `{"jsonrpc":"2.0", "method":"condenser_api.get_content", "params":["${un}", "${permlink}"], "id":1}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            method: "POST",
        })
            .then((response) => response.json())
            .then((res) => {
                if (res.result?.author === un) {
                    const content = res.result;
                    const json_metadata = content.json_metadata ? JSON.parse(content.json_metadata) : {};
                    if(json_metadata.enableServiceWorker === false){
                        reject("Not Supported");
                    }
                    const title = content.title || 'Untitled';
                    let description = content.body || 'No description available';
                    description = json_metadata.content?.description ||
                        json_metadata.video?.content?.description ||
                        description;
                    description = cleanDescription(description);
                    const hashy = json_metadata.vrHash || json_metadata.arHash || json_metadata.appHash || json_metadata.audHash || '';
                    const icons = json_metadata.appIcons || [
                        { "src": "https://dlux.io/img/dlux-hive-logo-alpha.svg", "sizes": "192x192", "type": "image/svg" },
                        { "src": "https://dlux.io/img/dlux-logo-icon.png", "sizes": "695x695", "type": "image/png", "purpose": "any" },
                        { "src": "https://dlux.io/img/dlux-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" }
                    ];
                    const manifest = {
                        "$schema": "https://json.schemastore.org/web-manifest-combined.json",
                        "name": title,
                        "short_name": "DLUX-dApp",
                        "start_url": `https://${h}/@${un}/${permlink}`,
                        "scope": `https://${h}/@${un}/${permlink}`,
                        "display": "standalone",
                        "background_color": "#111222",
                        "theme_color": "#111222",
                        "description": description,
                        "icons": icons
                    };
                    resolve({ js: JSON.stringify(manifest, null, 2) });
                } else {
                    reject("Not Found");
                }
            }).catch((e) => reject(e));
    });
}