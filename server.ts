import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Parser from "rss-parser";
import cors from "cors";

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  timeout: 10000, // 10 seconds timeout
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // API Route to fetch RSS feeds (to avoid CORS in browser)
  app.post("/api/fetch-rss", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
      // Use fetch first to have better control over headers and response
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://www.google.com/',
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        let message = `Status code ${response.status}`;
        if (response.status === 403) message = "Access denied by the source server (403). They might be blocking automated requests.";
        if (response.status === 404) message = "The RSS feed URL was not found (404).";
        return res.status(response.status).json({ error: message });
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || '';
      
      // Try to detect encoding from content-type or default to utf-8
      let charset = 'utf-8';
      const charsetMatch = contentType.match(/charset=([^;]+)/i);
      if (charsetMatch) {
        charset = charsetMatch[1].trim().toLowerCase();
      }

      let decoder = new TextDecoder(charset);
      let text = '';
      try {
        text = decoder.decode(buffer);
      } catch (e) {
        // Fallback to utf-8 if specified charset fails
        decoder = new TextDecoder('utf-8');
        text = decoder.decode(buffer);
      }

      let sanitizedText = text.trim();

      // Aggressively find the start of the XML document
      // This handles BOM, leading whitespace, or garbage characters
      const xmlStart = sanitizedText.indexOf('<');
      if (xmlStart > 0) {
        sanitizedText = sanitizedText.slice(xmlStart);
      } else if (xmlStart === -1) {
        return res.status(422).json({ error: "The source did not return valid XML." });
      }

      // Check if it looks like HTML instead of XML
      if (sanitizedText.toLowerCase().startsWith('<!doctype html') || sanitizedText.toLowerCase().startsWith('<html')) {
        return res.status(400).json({ 
          error: "The URL provided points to a webpage, not an RSS feed. Please provide a valid RSS/XML link.",
          details: "Received HTML instead of XML"
        });
      }

      try {
        const feed = await parser.parseString(sanitizedText);
        res.json(feed);
      } catch (parseError: any) {
        console.warn(`Standard parse failed for ${url}, attempting lenient parse:`, parseError.message);
        
        // Lenient Parse Fallback (Regex-based)
        // This handles very old or non-standard feeds that rss-parser might reject
        try {
          const items: any[] = [];
          // More inclusive regex for items/entries
          const itemRegex = /<(item|entry|article)[\s\S]*?>([\s\S]*?)<\/\1>/gi;
          let match;
          
          while ((match = itemRegex.exec(sanitizedText)) !== null) {
            const content = match[2];
            
            // Improved regex for title (handles namespaces)
            const titleMatch = content.match(/<(?:[\w-]*:)?title[\s\S]*?>([\s\S]*?)<\/(?:[\w-]*:)?title>/i);
            
            // Improved regex for link (handles attributes and content)
            let link = '';
            const linkTagMatch = content.match(/<(?:[\w-]*:)?link[\s\S]*?href=["']([\s\S]*?)["']/i);
            if (linkTagMatch) {
              link = linkTagMatch[1];
            } else {
              const linkContentMatch = content.match(/<(?:[\w-]*:)?link[\s\S]*?>([\s\S]*?)<\/(?:[\w-]*:)?link>/i);
              if (linkContentMatch) {
                link = linkContentMatch[1];
              } else {
                const guidMatch = content.match(/<(?:[\w-]*:)?guid[\s\S]*?>([\s\S]*?)<\/(?:[\w-]*:)?guid>/i);
                if (guidMatch) link = guidMatch[1];
              }
            }

            // Improved regex for description/content
            const descMatch = content.match(/<(?:[\w-]*:)?(?:description|summary|content|encoded)[\s\S]*?>([\s\S]*?)<\/(?:[\w-]*:)?(?:description|summary|content|encoded)>/i);
            
            // Improved regex for date
            const dateMatch = content.match(/<(?:[\w-]*:)?(?:pubDate|published|updated|date|created)[\s\S]*?>([\s\S]*?)<\/(?:[\w-]*:)?(?:pubDate|published|updated|date|created)>/i);

            const clean = (str: string | undefined) => {
              if (!str) return '';
              // Remove CDATA tags
              let cleaned = str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
              // Remove HTML tags
              cleaned = cleaned.replace(/<[^>]*>?/gm, '');
              // Decode basic entities
              cleaned = cleaned.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
              return cleaned.trim();
            };

            items.push({
              title: clean(titleMatch?.[1]) || 'Untitled',
              link: link.trim(),
              content: clean(descMatch?.[1]),
              pubDate: dateMatch?.[2]?.trim() || dateMatch?.[1]?.trim() || '',
            });
          }

          if (items.length > 0) {
            const titleMatch = sanitizedText.match(/<(?:[\w-]*:)?title[\s\S]*?>([\s\S]*?)<\/(?:[\w-]*:)?title>/i);
            return res.json({
              title: titleMatch ? clean(titleMatch[1]) : 'Legacy Feed',
              items: items
            });
          }
        } catch (lenientError) {
          console.error("Lenient parse also failed:", lenientError);
        }

        let errorMessage = "The source returned invalid XML or a malformed feed.";
        if (parseError.message.includes('not recognized')) {
          errorMessage = "The feed format is not standard RSS or Atom. The parser could not recognize it.";
        }
        
        res.status(422).json({ 
          error: errorMessage,
          details: parseError.message 
        });
      }
    } catch (error: any) {
      console.error(`Error fetching RSS from ${url}:`, error.message);
      
      let status = 500;
      let message = "Failed to fetch RSS feed";

      if (error.name === 'TimeoutError' || error.code === 'ECONNABORTED') {
        status = 408;
        message = "Request timed out. The source server is taking too long to respond.";
      } else if (error.message.includes('Invalid character') || error.message.includes('sax')) {
        message = "The source returned invalid XML. It might be an HTML page instead of an RSS feed.";
      }

      res.status(status).json({ error: message, details: error.message });
    }
  });

  // API Route to discover RSS feeds from a website URL
  app.post("/api/discover-rss", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const fetchWithHeaders = async (targetUrl: string) => {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
          'Referer': 'https://www.google.com/',
        },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || '';
      let charset = 'utf-8';
      const charsetMatch = contentType.match(/charset=([^;]+)/i);
      if (charsetMatch) charset = charsetMatch[1].trim().toLowerCase();

      let decoder = new TextDecoder(charset);
      let text = '';
      try {
        text = decoder.decode(buffer);
      } catch (e) {
        text = new TextDecoder('utf-8').decode(buffer);
      }

      let sanitizedText = text.trim();
      const xmlStart = sanitizedText.indexOf('<');
      if (xmlStart > 0) sanitizedText = sanitizedText.slice(xmlStart);
      
      if (sanitizedText.toLowerCase().startsWith('<!doctype html') || sanitizedText.toLowerCase().startsWith('<html')) {
        throw new Error("HTML response");
      }
      return await parser.parseString(sanitizedText);
    };

    try {
      // 1. Try the URL directly
      try {
        const feed = await fetchWithHeaders(url);
        return res.json({ title: feed.title, url: url });
      } catch (e) {
        // Continue to discovery if direct fails
      }
      
      // 2. Search for common RSS paths
      const commonPaths = ['/rss', '/feed', '/rss.xml', '/index.xml', '/feed.xml', '/atom.xml', '/market/feed/'];
      const baseUrl = url.replace(/\/$/, '');
      
      for (const path of commonPaths) {
        try {
          const testUrl = `${baseUrl}${path}`;
          const feed = await fetchWithHeaders(testUrl);
          return res.json({ title: feed.title, url: testUrl });
        } catch (e) { continue; }
      }

      res.status(404).json({ 
        error: "Could not automatically find a valid RSS feed for this website.",
        details: "Tried common paths like /rss, /feed, etc. but none returned valid XML."
      });
    } catch (error: any) {
      console.error(`Discovery failed for ${url}:`, error.message);
      res.status(500).json({ error: "Discovery failed", details: error.message });
    }
  });

  // API Route to suggest top sources using Gemini
  app.post("/api/suggest-sources", async (req, res) => {
    const { category } = req.body;
    // This would call Gemini to get a list of high-quality RSS feeds for the category
    // For the sake of the demo and immediate utility, we'll implement this in the client 
    // using the Gemini service we already have.
    res.json({ message: "Use the Gemini service to generate these suggestions." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
