import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateMarketSummary(articles: any[], category: string) {
  const prompt = `
    Analyze the following news articles related to the ${category} market and provide a concise, professional summary for a financial analyst.
    Focus on key trends, significant price movements, and potential market impacts.
    Format the output in Markdown with clear headings and bullet points.

    Articles:
    ${articles.map(a => `- Title: ${a.title}\n  Snippet: ${a.content}`).join('\n\n')}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Error generating summary:", error);
    return "Failed to generate summary.";
  }
}

export async function suggestSources(category: string) {
  const prompt = `
    Generate a list of 10 high-quality, active RSS feed URLs for financial news and analysis specifically for the "${category}" market.
    ${category === 'stocks' ? 'Focus specifically on India (NSE/BSE) and USA (NYSE/NASDAQ) markets.' : ''}
    Return the response as a JSON array of objects with "name" and "url" properties.
    Only include valid, well-known RSS feed URLs from reputable financial news organizations (e.g., Reuters, Bloomberg, CNBC, Economic Times, Yahoo Finance, etc.).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Error suggesting sources:", error);
    return [];
  }
}

export async function detectAssetCategory(asset: string) {
  const prompt = `
    Identify the financial market category for the following asset or symbol: "${asset}".
    Categories must be exactly one of: "stocks", "currency", "commodity", "indices", "crypto".
    
    Rules:
    - Gold (XAU), Silver (XAG), Oil, Gas, Wheat, Corn, etc. are "commodity".
    - Forex pairs (EURUSD, GBPJPY, etc.) are "currency".
    - Bitcoin, Ethereum, etc. are "crypto".
    - S&P 500, Nifty 50, NASDAQ, etc. are "indices".
    - Individual company names or tickers (Apple, AAPL, Reliance, etc.) are "stocks".
    
    Return ONLY the category name in lowercase.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    const category = response.text.trim().toLowerCase();
    const valid = ["stocks", "currency", "commodity", "indices", "crypto"];
    return valid.includes(category) ? category : "stocks";
  } catch (error) {
    console.error("Error detecting asset category:", error);
    return "stocks";
  }
}

export async function searchAndAnalyzeAsset(asset: string, category: string) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const prompt = `
    Perform a comprehensive search and analysis for the financial asset: "${asset}" in the "${category}" category.
    
    Structure the report EXACTLY as follows:

    # Current Market Analysis for ${asset.toUpperCase()} - ${currentDate}

    ## FUNDAMENTAL ANALYSIS (70% Weightage)
    - Study all latest events, news, and macroeconomic factors.
    - Create a detailed, aggregated report of news events.
    - Focus on how these events are impacting the asset's value.
    - Use tables to summarize key economic data or event impacts if applicable.

    ## TECHNICAL ANALYSIS (30% Weightage)
    - Provide key technical levels (Support/Resistance).
    - Mention current trends, indicators (RSI, Moving Averages), and chart patterns.
    - Use a table for "Key Technical Levels" (Level Type, Price, Significance).

    ## SOURCES USED
    - List the major and latest sources used to create this report (Max 10).
    - Format as a clean bulleted list with source names and URLs if possible.

    ---
    **Copyright © ${new Date().getFullYear()} FinMarket Bot. All Rights Reserved.**
    *Disclaimer: This report is for informational purposes only and does not constitute financial advice. Trading involves significant risk. Always perform your own due diligence.*

    Format the output in Markdown. Use large, bold headings (##) for subsections.
    
    CRITICAL: Ensure proper line spacing by using double line breaks (\n\n) between every section, subsection, table, and paragraph to ensure maximum readability.
    
    Also, identify any reputable RSS feed URLs or news source URLs found during your search that would be valuable for tracking this asset in the future.
    Return these sources in a separate section at the end titled "DISCOVERED_SOURCES" followed by a JSON array of objects with "name" and "url".
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    
    const text = response.text;
    const parts = text.split("DISCOVERED_SOURCES");
    const report = parts[0].trim();
    let discoveredSources = [];
    
    if (parts.length > 1) {
      try {
        const jsonMatch = parts[1].match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          discoveredSources = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.warn("Failed to parse discovered sources JSON", e);
      }
    }
    
    return { report, discoveredSources };
  } catch (error) {
    console.error("Error searching and analyzing asset:", error);
    return { report: "Failed to perform search-based analysis.", discoveredSources: [] };
  }
}

export async function detectCategoryAndTags(name: string, url: string) {
  const prompt = `
    Given the following financial news source name and URL, determine which market category it belongs to and suggest 3-5 relevant tags.
    Name: ${name}
    URL: ${url}

    Categories must be one of: "stocks", "currency", "commodity", "indices", "crypto".
    Note: Gold (XAU), Silver (XAG), Oil, Gas, and other physical raw materials belong to "commodity".
    
    Tags should be short, relevant keywords (e.g., "India", "Tech", "Forex", "Oil", "Bitcoin").

    Return the response as a JSON object with "category" and "tags" (array of strings) properties.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Error detecting category:", error);
    return { category: "stocks", tags: ["General"] };
  }
}

export async function generateThematicResearch(theme: string) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const prompt = `
    Perform a deep-dive thematic research on the following subject: "${theme}".
    
    Your task is to:
    1. Identify the primary and secondary asset classes impacted by this theme (e.g., Equities, Fixed Income, Commodities, Currencies, Crypto).
    2. Analyze the current situation based on the latest news and data.
    3. Provide a detailed impact analysis for each identified asset class.
    
    Structure the report EXACTLY as follows:

    # Thematic Research: ${theme.toUpperCase()}
    *Date: ${currentDate}*

    ## EXECUTIVE SUMMARY
    - Provide a high-level overview of the theme and its immediate market relevance.

    ## IMPACTED ASSET CLASSES & ASSETS
    - List the asset classes and specific key assets (e.g., Gold, S&P 500, USD/INR) most affected by this theme.
    - Use a table with columns: [Asset Class, Key Assets, Impact Direction (Bullish/Bearish/Neutral), Reason].

    ## DETAILED ANALYSIS
    - Break down the analysis by major market drivers related to the theme.
    - Discuss macroeconomic implications, geopolitical factors, or specific policy decisions.

    ## STRATEGIC OUTLOOK
    - Provide short-term and medium-term outlooks for the markets based on this theme.
    - Identify potential risks and opportunities for investors.

    ## SOURCES USED
    - List the major and latest sources used to create this report.

    ---
    **Copyright © ${new Date().getFullYear()} FinMarket Bot. All Rights Reserved.**
    *Disclaimer: This report is for informational purposes only and does not constitute financial advice.*

    Format the output in Markdown. Use large, bold headings (##) for subsections.
    Ensure proper line spacing by using double line breaks (\n\n) between every section, subsection, table, and paragraph.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview", // Use Pro for complex thematic research
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    
    return response.text;
  } catch (error) {
    console.error("Error generating thematic research:", error);
    return "Failed to generate thematic research report.";
  }
}
