import React, { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  Timestamp,
  deleteDoc,
  doc,
  getDocs,
  where
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  generateMarketSummary, 
  suggestSources, 
  detectCategoryAndTags,
  searchAndAnalyzeAsset,
  detectAssetCategory,
  generateThematicResearch
} from './services/gemini';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  TrendingUp, 
  Globe, 
  BarChart3, 
  Coins, 
  Zap, 
  Plus, 
  Trash2, 
  RefreshCw, 
  ExternalLink,
  ChevronRight,
  LayoutDashboard,
  Settings as SettingsIcon,
  LogOut,
  Search,
  Wand2,
  CheckCircle2,
  Eye,
  X,
  Download,
  RotateCcw,
  Clock,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type MarketCategory = 'stocks' | 'currency' | 'commodity' | 'indices' | 'crypto';

interface Source {
  id: string;
  name: string;
  url: string;
  category: MarketCategory;
  tags?: string[];
}

interface WatchlistItem {
  id: string;
  symbol: string;
  category: string;
  uid: string;
  createdAt: any;
}

interface Article {
  id: string;
  title: string;
  link: string;
  content: string;
  pubDate: any;
  category: MarketCategory;
  sourceName: string;
}

interface Summary {
  id: string;
  date: any;
  content: string;
  category: MarketCategory;
  isDeep?: boolean;
  targetAsset?: string | null;
}

interface ThematicReport {
  id: string;
  theme: string;
  content: string;
  date: any;
  uid: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the whole app, but we log it clearly
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MarketCategory>('stocks');
  const [sources, setSources] = useState<Source[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState({ name: '', url: '', category: 'stocks' as MarketCategory });
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [addSourceError, setAddSourceError] = useState<string | null>(null);
  const [sectorInterests, setSectorInterests] = useState<Record<MarketCategory, number>>({
    stocks: 0,
    currency: 0,
    commodity: 0,
    indices: 0,
    crypto: 0
  });
  const [allTags, setAllTags] = useState<string[]>([]);
  const [isDeepAnalyzing, setIsDeepAnalyzing] = useState(false);
  const [thematicTheme, setThematicTheme] = useState('');
  const [isThematicLoading, setIsThematicLoading] = useState(false);
  const [thematicReports, setThematicReports] = useState<ThematicReport[]>([]);
  const [selectedThematicId, setSelectedThematicId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'dashboard' | 'thematic'>('dashboard');

  useEffect(() => {
    const testConnection = async () => {
      try {
        const { getDocFromServer, doc } = await import('firebase/firestore');
        await getDocFromServer(doc(db, '_connection_test_', 'ping'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          console.error("Firestore connection failed: client is offline. Check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen to sources
    const qSources = query(collection(db, 'sources'));
    const unsubSources = onSnapshot(qSources, (snapshot) => {
      setSources(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Source)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'sources'));

    // Listen to articles
    const qArticles = query(collection(db, 'articles'), orderBy('pubDate', 'desc'), limit(50));
    const unsubArticles = onSnapshot(qArticles, (snapshot) => {
      setArticles(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Article)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'articles'));

    // Listen to summaries
    const qSummaries = query(collection(db, 'summaries'), orderBy('date', 'desc'), limit(10));
    const unsubSummaries = onSnapshot(qSummaries, (snapshot) => {
      setSummaries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Summary)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'summaries'));

    // Listen to watchlist
    const qWatchlist = query(collection(db, 'watchlist'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubWatchlist = onSnapshot(qWatchlist, (snapshot) => {
      setWatchlist(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as WatchlistItem)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'watchlist'));

    // Listen to thematic reports
    const qThematic = query(collection(db, 'thematic_reports'), where('uid', '==', user.uid), orderBy('date', 'desc'), limit(10));
    const unsubThematic = onSnapshot(qThematic, (snapshot) => {
      setThematicReports(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ThematicReport)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'thematic_reports'));

    return () => {
      unsubSources();
      unsubArticles();
      unsubSummaries();
      unsubWatchlist();
      unsubThematic();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.url) return;
    
    setIsDiscovering(true);
    setAddSourceError(null);
    try {
      // Try to discover RSS if it's just a website URL
      const res = await fetch('/api/discover-rss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newSource.url })
      });
      
      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn("Invalid response from discovery");
      }

      if (!res.ok) {
        setAddSourceError(data?.error || "Failed to discover RSS feed. Please check the URL.");
        setIsDiscovering(false);
        return;
      }

      const finalUrl = data?.url || newSource.url;
      const finalName = newSource.name || data?.title || newSource.url;

      // Auto-detect category and tags
      const detection = await detectCategoryAndTags(finalName, finalUrl);

      const sourceToAdd = {
        name: finalName,
        url: finalUrl,
        category: detection.category as MarketCategory,
        tags: detection.tags || []
      };

      await addDoc(collection(db, 'sources'), sourceToAdd);
      setNewSource({ name: '', url: '', category: 'stocks' });
      setShowAddSource(false);
    } catch (error) {
      console.error("Error adding source:", error);
      // Fallback: add as is if detection fails
      try {
        await addDoc(collection(db, 'sources'), {
          ...newSource,
          tags: ['General']
        });
        setNewSource({ name: '', url: '', category: 'stocks' });
        setShowAddSource(false);
      } catch (e) {
        console.error("Final fallback failed:", e);
      }
    } finally {
      setIsDiscovering(false);
    }
  };

  useEffect(() => {
    // Extract all unique tags from sources
    const tags = new Set<string>();
    sources.forEach(s => s.tags?.forEach(t => tags.add(t)));
    setAllTags(Array.from(tags).slice(0, 20));
  }, [sources]);

  useEffect(() => {
    // Load interests from localStorage
    const savedInterests = localStorage.getItem('sectorInterests');
    if (savedInterests) {
      try {
        setSectorInterests(JSON.parse(savedInterests));
      } catch (e) {
        console.error("Failed to parse saved interests");
      }
    }
  }, []);

  const trackInterest = (category: MarketCategory) => {
    const newInterests = {
      ...sectorInterests,
      [category]: (sectorInterests[category] || 0) + 1
    };
    setSectorInterests(newInterests);
    localStorage.setItem('sectorInterests', JSON.stringify(newInterests));
  };

  const sortedCategories = (['stocks', 'currency', 'commodity', 'indices', 'crypto'] as MarketCategory[])
    .sort((a, b) => (sectorInterests[b] || 0) - (sectorInterests[a] || 0));

  const addToWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol || !user) return;
    
    let category = activeTab;
    // Simple auto-detection for common assets
    const symbol = newSymbol.toUpperCase();
    if (symbol.includes('XAU') || symbol.includes('GOLD') || symbol.includes('OIL') || symbol.includes('XAG')) {
      category = 'commodity';
    } else if (symbol.length === 6 && !symbol.includes('USDT')) {
      category = 'currency';
    }

    try {
      await addDoc(collection(db, 'watchlist'), {
        symbol: symbol,
        category: category,
        uid: user.uid,
        createdAt: Timestamp.now()
      });
      setNewSymbol('');
    } catch (error) {
      console.error("Error adding to watchlist:", error);
    }
  };

  const removeFromWatchlist = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'watchlist', id));
    } catch (error) {
      console.error("Error removing from watchlist:", error);
    }
  };

  const autoGenerateSources = async () => {
    setIsSuggesting(true);
    try {
      const suggestions = await suggestSources(activeTab);
      for (const suggestion of suggestions) {
        // Check if exists
        const q = query(collection(db, 'sources'), where('url', '==', suggestion.url));
        const existing = await getDocs(q);
        if (existing.empty) {
          await addDoc(collection(db, 'sources'), {
            ...suggestion,
            category: activeTab
          });
        }
      }
    } catch (error) {
      console.error("Auto-suggest failed:", error);
    } finally {
      setIsSuggesting(false);
    }
  };

  const deleteSource = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'sources', id));
    } catch (error) {
      console.error("Error deleting source:", error);
    }
  };

  const fetchAndAnalyze = async (specificAsset?: string) => {
    setIsFetching(true);
    if (specificAsset) setIsDeepAnalyzing(true);
    
    try {
      // 0. Detect correct category if specific asset is provided
      let targetCategory = activeTab;
      if (specificAsset) {
        targetCategory = await detectAssetCategory(specificAsset) as MarketCategory;
        // Switch to that tab if it's different
        if (targetCategory !== activeTab) {
          setActiveTab(targetCategory);
          trackInterest(targetCategory);
        }
      }

      const categorySources = sources.filter(s => s.category === targetCategory);
      const allNewArticles: any[] = [];

      // 1. Standard RSS Fetch
      for (const source of categorySources) {
        try {
          const res = await fetch('/api/fetch-rss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: source.url })
          });
          
          if (res.ok) {
            const text = await res.text();
            const feed = JSON.parse(text);
            if (feed.items) {
              for (const item of feed.items.slice(0, 5)) {
                const articleData = {
                  title: item.title,
                  link: item.link,
                  content: item.contentSnippet || item.content || '',
                  pubDate: item.pubDate ? Timestamp.fromDate(new Date(item.pubDate)) : Timestamp.now(),
                  category: targetCategory,
                  sourceName: source.name,
                  sourceId: source.id
                };
                
                const existing = articles.find(a => a.link === item.link);
                if (!existing) {
                  const docRef = await addDoc(collection(db, 'articles'), articleData);
                  allNewArticles.push({ ...articleData, id: docRef.id });
                } else {
                  allNewArticles.push(existing);
                }
              }
            }
          }
        } catch (e) { console.error(e); }
      }

      // 2. Search-based Deep Analysis
      const searchTarget = specificAsset || targetCategory;
      const { report, discoveredSources } = await searchAndAnalyzeAsset(searchTarget, targetCategory);
      
      // Save summary
      await addDoc(collection(db, 'summaries'), {
        date: Timestamp.now(),
        content: report,
        category: targetCategory,
        isDeep: !!specificAsset,
        targetAsset: specificAsset || null
      });

      // 3. Auto-add discovered sources
      for (const source of discoveredSources) {
        const q = query(collection(db, 'sources'), where('url', '==', source.url));
        const existing = await getDocs(q);
        if (existing.empty) {
          const detection = await detectCategoryAndTags(source.name, source.url);
          await addDoc(collection(db, 'sources'), {
            name: source.name,
            url: source.url,
            category: detection.category,
            tags: detection.tags
          });
        }
      }
    } catch (error) {
      console.error("Fetch/Analyze failed:", error);
    } finally {
      setIsFetching(false);
      setIsDeepAnalyzing(false);
    }
  };

  const handleRunThematicResearch = async () => {
    if (!thematicTheme.trim() || !user) return;
    
    // Check for API key if using Pro models
    if ((window as any).aistudio && !(await (window as any).aistudio.hasSelectedApiKey())) {
      await (window as any).aistudio.openSelectKey();
      // Proceed after selection
    }

    setIsThematicLoading(true);
    try {
      const reportContent = await generateThematicResearch(thematicTheme);
      
      const docRef = await addDoc(collection(db, 'thematic_reports'), {
        theme: thematicTheme,
        content: reportContent,
        date: Timestamp.now(),
        uid: user.uid
      });
      
      setSelectedThematicId(docRef.id);
      setThematicTheme('');
    } catch (error: any) {
      console.error("Thematic research failed:", error);
      handleFirestoreError(error, OperationType.WRITE, 'thematic_reports');
    } finally {
      setIsThematicLoading(false);
    }
  };

  const deleteThematicReport = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'thematic_reports', id));
    } catch (error) {
      console.error("Error deleting thematic report:", error);
    }
  };

  const exportToPDF = (content: string, assetName: string) => {
    const doc = new jsPDF();
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (margin * 2);
    
    const currentDate = format(new Date(), 'MMMM dd, yyyy');
    const title = `Market Analysis: ${assetName.toUpperCase()}`;
    const subtitle = `Generated on ${currentDate}`;
    
    // Header
    doc.setFillColor(20, 20, 20);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(title, margin, 25);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(subtitle, margin, 35);
    
    let currentY = 55;
    doc.setTextColor(20, 20, 20);

    const lines = content.split('\n');
    let tableData: string[][] = [];
    let inTable = false;

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // Handle Tables
      if (trimmedLine.startsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableData = [];
        }
        
        // Skip separator lines like |---|---|
        if (trimmedLine.includes('---')) return;
        
        const row = trimmedLine
          .split('|')
          .filter(cell => cell.trim() !== '' || (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')))
          .map(cell => cell.trim());
        
        // Filter out empty strings at start/end if they were caused by split
        if (trimmedLine.startsWith('|') && row[0] === '') row.shift();
        if (trimmedLine.endsWith('|') && row[row.length-1] === '') row.pop();
        
        if (row.length > 0) {
          tableData.push(row);
        }
        return;
      } else if (inTable) {
        // Table ended, render it
        if (tableData.length > 0) {
          const head = tableData[0];
          const body = tableData.slice(1);
          
          autoTable(doc, {
            head: [head],
            body: body,
            startY: currentY,
            margin: { left: margin, right: margin },
            theme: 'grid',
            headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 3 },
            didDrawPage: (data) => {
              currentY = data.cursor?.y || currentY;
            }
          });
          currentY = (doc as any).lastAutoTable.finalY + 10;
        }
        inTable = false;
        tableData = [];
      }

      if (trimmedLine === '') {
        currentY += 5;
        return;
      }

      // Check for page overflow
      if (currentY > 270) {
        doc.addPage();
        currentY = 20;
      }

      // Headers
      if (line.startsWith('# ')) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        const text = line.replace('# ', '');
        const splitText = doc.splitTextToSize(text, contentWidth);
        doc.text(splitText, margin, currentY);
        currentY += (splitText.length * 10);
      } else if (line.startsWith('## ')) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        const text = line.replace('## ', '');
        const splitText = doc.splitTextToSize(text, contentWidth);
        doc.text(splitText, margin, currentY);
        currentY += (splitText.length * 8);
      } else if (line.startsWith('### ')) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        const text = line.replace('### ', '');
        const splitText = doc.splitTextToSize(text, contentWidth);
        doc.text(splitText, margin, currentY);
        currentY += (splitText.length * 7);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // Bullet points
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const text = '• ' + line.substring(2);
        const splitText = doc.splitTextToSize(text, contentWidth - 5);
        doc.text(splitText, margin + 5, currentY);
        currentY += (splitText.length * 6);
      } else {
        // Normal text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        
        // Simple bold handling: replace **text** with bold text is hard in jsPDF without a parser
        // For now, just render as normal but with better wrapping
        const splitText = doc.splitTextToSize(line, contentWidth);
        doc.text(splitText, margin, currentY);
        currentY += (splitText.length * 6);
      }
    });

    // Handle case where table is at the very end
    if (inTable && tableData.length > 0) {
      const head = tableData[0];
      const body = tableData.slice(1);
      autoTable(doc, {
        head: [head],
        body: body,
        startY: currentY,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3 }
      });
      currentY = (doc as any).lastAutoTable.finalY + 10;
    }

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Page ${i} of ${pageCount} | FinMarket Bot Research Terminal`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    doc.save(`FinMarket_Research_${assetName.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const deleteSummary = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'summaries', id));
    } catch (error) {
      console.error("Error deleting summary:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center font-mono">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="animate-spin text-[#141414]" size={32} />
          <p className="text-xs uppercase tracking-widest opacity-50">Initializing Terminal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white border border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]"
        >
          <div className="flex items-center gap-3 mb-8">
            <BarChart3 className="text-[#141414]" size={32} />
            <h1 className="text-2xl font-bold uppercase tracking-tighter">FinMarket Bot</h1>
          </div>
          <p className="text-sm text-gray-600 mb-8 leading-relaxed">
            Access automated financial market research, daily summaries, and real-time news aggregation for stocks, currency, commodities, and crypto.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full bg-[#141414] text-white py-4 px-6 font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors flex items-center justify-center gap-3"
          >
            Authenticate with Google
          </button>
        </motion.div>
      </div>
    );
  }

  const filteredArticles = articles.filter(a => a.category === activeTab);
  const latestSummary = summaries.find(s => s.category === activeTab);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[#141414] bg-white flex flex-col">
        <div className="p-6 border-bottom border-[#141414] flex items-center gap-2">
          <BarChart3 size={24} />
          <span className="font-black uppercase tracking-tighter text-xl">FinBot v1.0</span>
        </div>
        
        <nav className="flex-1 py-6">
          <div className="px-6 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Market Sectors</p>
            <div className="space-y-1">
              {sortedCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveTab(cat);
                    trackInterest(cat);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-tight transition-all",
                    activeTab === cat ? "bg-[#141414] text-white" : "hover:bg-gray-100"
                  )}
                >
                  {cat === 'stocks' && <TrendingUp size={16} />}
                  {cat === 'currency' && <Globe size={16} />}
                  {cat === 'commodity' && <Zap size={16} />}
                  {cat === 'indices' && <BarChart3 size={16} />}
                  {cat === 'crypto' && <Coins size={16} />}
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="px-6 mt-8">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Market Tags</p>
            <div className="flex flex-wrap gap-1">
              {allTags.map(tag => (
                <span 
                  key={tag} 
                  className="text-[9px] font-bold uppercase bg-gray-50 border border-gray-200 px-1.5 py-0.5 opacity-60 hover:opacity-100 cursor-default transition-opacity"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="px-6 mt-8">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Research Tools</p>
            <button 
              onClick={() => setActiveView('dashboard')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-tight transition-all",
                activeView === 'dashboard' ? "bg-[#141414] text-white" : "hover:bg-gray-100"
              )}
            >
              <LayoutDashboard size={16} />
              Sector Dashboard
            </button>
            <button 
              onClick={() => setActiveView('thematic')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-tight transition-all",
                activeView === 'thematic' ? "bg-[#141414] text-white" : "hover:bg-gray-100"
              )}
            >
              <Wand2 size={16} />
              Thematic Research
            </button>
          </div>

          <div className="px-6 mt-8">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">System</p>
            <button 
              onClick={() => setShowAddSource(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-tight hover:bg-gray-100"
            >
              <Plus size={16} />
              Add Source
            </button>
          </div>
        </nav>

        <div className="p-6 border-t border-[#141414] bg-gray-50">
          <div className="flex items-center gap-3 mb-4">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-[#141414]" alt="" />
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">{user.displayName}</p>
              <p className="text-[10px] opacity-50 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase border border-[#141414] hover:bg-[#141414] hover:text-white transition-all"
          >
            <LogOut size={12} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-[#141414] bg-white flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-black uppercase tracking-widest">
              {activeView === 'dashboard' ? `${activeTab} Research Terminal` : 'Thematic Research Lab'}
            </h2>
            <div className="h-4 w-[1px] bg-[#141414] opacity-20"></div>
            <p className="text-[10px] font-mono opacity-50">{format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
          </div>
          
          <div className="flex items-center gap-3">
            {activeView === 'dashboard' ? (
              <>
                <div className="relative group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30 group-focus-within:opacity-100 transition-opacity" size={12} />
                  <input 
                    type="text" 
                    placeholder="SEARCH ASSET CLASS..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 pr-4 py-2 border border-[#141414] text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:bg-gray-50 w-48 transition-all"
                  />
                </div>

                <button 
                  onClick={autoGenerateSources}
                  disabled={isSuggesting}
                  className={cn(
                    "flex items-center gap-2 border border-[#141414] px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-gray-50 transition-all disabled:opacity-50",
                    isSuggesting && "animate-pulse"
                  )}
                >
                  {isSuggesting ? <RefreshCw className="animate-spin" size={12} /> : <Wand2 size={12} />}
                  {isSuggesting ? "Suggesting..." : "Auto-Suggest Sources"}
                </button>

                <button 
                  onClick={() => fetchAndAnalyze(searchQuery || undefined)}
                  disabled={isFetching}
                  className={cn(
                    "flex items-center gap-2 bg-[#141414] text-white px-6 py-2 text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50",
                    isFetching && "animate-pulse"
                  )}
                >
                  {isFetching ? <RefreshCw className="animate-spin" size={14} /> : <Zap size={14} />}
                  {isFetching ? (isDeepAnalyzing ? "Deep Analysis..." : "Processing...") : (searchQuery ? "Analyze Asset" : "Run Analysis")}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <input 
                  type="text" 
                  placeholder="ENTER RESEARCH THEME (e.g. FED RATE CUT IMPACT)..."
                  value={thematicTheme}
                  onChange={(e) => setThematicTheme(e.target.value)}
                  className="bg-gray-100 border border-[#141414] px-4 py-2 text-[10px] font-bold uppercase w-96 focus:outline-none focus:bg-white"
                />
                <button 
                  onClick={handleRunThematicResearch}
                  disabled={isThematicLoading || !thematicTheme.trim()}
                  className={cn(
                    "flex items-center gap-2 bg-[#141414] text-white px-6 py-2 text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50",
                    isThematicLoading && "animate-pulse"
                  )}
                >
                  {isThematicLoading ? <RefreshCw className="animate-spin" size={14} /> : <Wand2 size={14} />}
                  {isThematicLoading ? "Generating Report..." : "Generate Thematic Report"}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        {activeView === 'dashboard' ? (
          <div className="flex-1 overflow-y-auto p-8 grid grid-cols-12 gap-8">
            {/* Summary Section */}
            <section className="col-span-12 lg:col-span-7 space-y-8">
              <div className="bg-white border border-[#141414] p-8 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-black uppercase italic tracking-tighter">AI Market Analysis</h3>
                    {latestSummary?.isDeep && (
                      <span className="bg-emerald-100 text-emerald-800 text-[8px] font-bold px-2 py-0.5 uppercase rounded-full">Deep Research</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {latestSummary && (
                      <>
                        <button 
                          onClick={() => exportToPDF(latestSummary.content, latestSummary.targetAsset || activeTab)}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                          title="Export to PDF"
                        >
                          <Download size={14} />
                        </button>
                        <button 
                          onClick={() => fetchAndAnalyze(latestSummary.targetAsset || undefined)}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors text-blue-600"
                          title="Update/Regenerate"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button 
                          onClick={() => deleteSummary(latestSummary.id)}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors text-red-500"
                          title="Delete Analysis"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    {latestSummary && (
                      <span className="text-[10px] font-mono opacity-50 ml-2">
                        {format(latestSummary.date.toDate(), 'MMM dd, HH:mm')}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="prose prose-sm max-w-none prose-headings:uppercase prose-headings:tracking-tighter prose-headings:italic prose-p:leading-relaxed prose-h1:text-2xl prose-h1:font-black prose-h1:mt-12 prose-h1:mb-8 prose-h2:text-xl prose-h2:font-bold prose-h2:mt-10 prose-h2:mb-6 prose-h3:text-lg prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-4 prose-p:mb-6 prose-li:mb-3 prose-table:my-8 prose-table:border prose-table:border-collapse prose-th:border prose-th:p-2 prose-td:border prose-td:p-2">
                  {latestSummary ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestSummary.content}</ReactMarkdown>
                  ) : (
                    <div className="py-12 text-center opacity-30">
                      <BarChart3 className="mx-auto mb-4" size={48} />
                      <p className="text-sm font-bold uppercase">No analysis generated yet.</p>
                      <p className="text-xs mt-2">Click 'Run Analysis' to start the research bot.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* News Feed */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-50">Recent Intelligence</h3>
                <div className="space-y-2">
                  {filteredArticles.length > 0 ? (
                    filteredArticles.map(article => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={article.id}
                        className="bg-white border border-[#141414] p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors group cursor-pointer"
                        onClick={() => window.open(article.link, '_blank')}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-bold uppercase bg-[#141414] text-white px-1.5 py-0.5">{article.sourceName}</span>
                            <span className="text-[9px] font-mono opacity-40">{format(article.pubDate.toDate(), 'HH:mm')}</span>
                          </div>
                          <h4 className="text-sm font-bold leading-tight group-hover:underline">{article.title}</h4>
                          <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">{article.content}</p>
                        </div>
                        <ExternalLink size={14} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                      </motion.div>
                    ))
                  ) : (
                    <p className="text-xs opacity-40 italic">No news items found for this sector.</p>
                  )}
                </div>
              </div>
            </section>

            {/* Sidebar Info */}
            <aside className="col-span-12 lg:col-span-5 space-y-8">
              {/* Sources List */}
              <div className="bg-white border border-[#141414] p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xs font-black uppercase tracking-widest">Active Sources</h3>
                  <span className="text-[10px] font-mono bg-gray-100 px-2 py-1">{sources.filter(s => s.category === activeTab).length} Total</span>
                </div>
                
                <div className="space-y-3">
                  {sources
                    .filter(s => s.category === activeTab)
                    .filter(s => 
                      searchQuery === '' || 
                      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      s.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
                    )
                    .map(source => (
                    <div key={source.id} className="p-3 border border-gray-100 hover:border-[#141414] transition-all group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold truncate">{source.name}</p>
                          <p className="text-[10px] opacity-40 truncate">{source.url}</p>
                        </div>
                        <button 
                          onClick={() => deleteSource(source.id)}
                          className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {source.tags && source.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {source.tags.map(tag => (
                            <span key={tag} className="text-[8px] font-bold uppercase bg-gray-100 px-1.5 py-0.5 border border-gray-200">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {sources.filter(s => s.category === activeTab).length === 0 && (
                    <p className="text-[10px] opacity-40 italic py-4 text-center">No sources configured for {activeTab}.</p>
                  )}
                </div>
              </div>

              {/* Watchlist Section */}
              <div className="bg-white border border-[#141414] p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                    <Eye size={14} />
                    My Watchlist
                  </h3>
                  <span className="text-[10px] font-mono bg-gray-100 px-2 py-1">{watchlist.length}</span>
                </div>
                
                <form onSubmit={addToWatchlist} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newSymbol}
                    onChange={e => setNewSymbol(e.target.value)}
                    placeholder="ADD SYMBOL (e.g. RELIANCE, AAPL)"
                    className="flex-1 border border-[#141414] px-3 py-2 text-[10px] font-bold uppercase focus:outline-none"
                  />
                  <button type="submit" className="bg-[#141414] text-white p-2 hover:bg-gray-800">
                    <Plus size={14} />
                  </button>
                </form>

                <div className="grid grid-cols-2 gap-2">
                  {watchlist.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-2 border border-gray-100 bg-gray-50 group">
                      <div className="overflow-hidden">
                        <p className="text-[10px] font-black tracking-tight">{item.symbol}</p>
                        <p className="text-[8px] opacity-40 uppercase">{item.category}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            setActiveTab(item.category as MarketCategory);
                            fetchAndAnalyze(item.symbol);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-emerald-600 hover:bg-emerald-50 p-1 transition-all"
                          title="Deep Analysis"
                        >
                          <Search size={12} />
                        </button>
                        <button 
                          onClick={() => removeFromWatchlist(item.id)}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50 p-1 transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {watchlist.length === 0 && (
                    <p className="col-span-2 text-[10px] opacity-40 italic py-4 text-center border border-dashed border-gray-200">Watchlist is empty.</p>
                  )}
                </div>
              </div>

              {/* System Status */}
              <div className="bg-[#141414] text-white p-6 font-mono">
                <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-50">Bot Status</h3>
                <div className="space-y-2 text-[10px]">
                  <div className="flex justify-between">
                    <span className="opacity-50">ENGINE:</span>
                    <span className="text-emerald-400">OPERATIONAL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-50">AI MODEL:</span>
                    <span>GEMINI-3-FLASH</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-50">DATABASE:</span>
                    <span>FIRESTORE CLOUD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-50">LAST RUN:</span>
                    <span>{latestSummary ? format(latestSummary.date.toDate(), 'HH:mm:ss') : 'NEVER'}</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-8 grid grid-cols-12 gap-8">
            {/* Thematic Reports List */}
            <aside className="col-span-12 lg:col-span-4 space-y-6">
              <div className="bg-white border border-[#141414] p-6">
                <h3 className="text-xs font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                  <FileText size={14} />
                  Recent Reports
                </h3>
                <div className="space-y-3">
                  {thematicReports.map(report => (
                    <div 
                      key={report.id} 
                      onClick={() => setSelectedThematicId(report.id)}
                      className={cn(
                        "p-4 border transition-all group cursor-pointer",
                        selectedThematicId === report.id || (!selectedThematicId && thematicReports[0]?.id === report.id)
                          ? "border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
                          : "border-gray-100 bg-gray-50 hover:border-[#141414]"
                      )}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-xs font-bold uppercase leading-tight">{report.theme}</h4>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteThematicReport(report.id);
                            if (selectedThematicId === report.id) setSelectedThematicId(null);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50 p-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono opacity-40">{format(report.date.toDate(), 'MMM dd, yyyy')}</span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            exportToPDF(report.content, report.theme);
                          }}
                          className="text-[9px] font-bold uppercase text-blue-600 hover:underline"
                        >
                          Export PDF
                        </button>
                      </div>
                    </div>
                  ))}
                  {thematicReports.length === 0 && (
                    <p className="text-[10px] opacity-40 italic py-8 text-center">No thematic reports generated yet.</p>
                  )}
                </div>
              </div>
            </aside>

            {/* Thematic Report Content */}
            <section className="col-span-12 lg:col-span-8">
              {thematicReports.length > 0 ? (
                <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
                  <div className="prose prose-sm max-w-none prose-headings:uppercase prose-headings:tracking-tighter prose-headings:italic prose-p:leading-relaxed prose-h1:text-3xl prose-h1:font-black prose-h1:mt-12 prose-h1:mb-8 prose-h2:text-2xl prose-h2:font-bold prose-h2:mt-10 prose-h2:mb-6 prose-h3:text-xl prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-4 prose-p:mb-6 prose-li:mb-3 prose-table:my-8 prose-table:border prose-table:border-collapse prose-th:border prose-th:p-2 prose-td:border prose-td:p-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {thematicReports.find(r => r.id === selectedThematicId)?.content || thematicReports[0].content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center border-2 border-dashed border-gray-200 opacity-30">
                  <div className="text-center">
                    <Wand2 className="mx-auto mb-4" size={48} />
                    <p className="text-sm font-bold uppercase">Enter a theme to begin research</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Add Source Modal */}
      <AnimatePresence>
        {showAddSource && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddSource(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white border border-[#141414] p-8 shadow-[12px_12px_0px_0px_rgba(20,20,20,1)]"
            >
              <h3 className="text-xl font-black uppercase tracking-tighter mb-6">Register New Source</h3>
              <form onSubmit={addSource} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-2">RSS Feed or Website URL</label>
                  <input 
                    type="url" 
                    required
                    value={newSource.url}
                    onChange={e => setNewSource({...newSource, url: e.target.value})}
                    placeholder="https://example.com"
                    className="w-full border border-[#141414] p-3 text-sm focus:outline-none focus:ring-2 ring-[#141414]/10"
                  />
                  <p className="text-[9px] mt-1 opacity-50 italic">The system will automatically detect the category and suggest relevant tags.</p>
                </div>

                {addSourceError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold uppercase">
                    {addSourceError}
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-2">Source Name (Optional)</label>
                  <input 
                    type="text" 
                    value={newSource.name}
                    onChange={e => setNewSource({...newSource, name: e.target.value})}
                    placeholder="e.g. Bloomberg Markets"
                    className="w-full border border-[#141414] p-3 text-sm focus:outline-none focus:ring-2 ring-[#141414]/10"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddSource(false)}
                    className="flex-1 border border-[#141414] py-3 text-xs font-bold uppercase tracking-widest hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isDiscovering}
                    className="flex-1 bg-[#141414] text-white py-3 text-xs font-bold uppercase tracking-widest hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isDiscovering && <RefreshCw className="animate-spin" size={14} />}
                    {isDiscovering ? "Discovering..." : "Register"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
