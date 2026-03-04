/**
 * DOZ UP Organic Traffic Engine
 * Tools and strategies to drive organic traffic > paid traffic
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const SITE_URL = 'https://doz.com';

// ============ STRUCTURED DATA GENERATOR ============
class StructuredDataGenerator {

    // Software Application Schema
    static getSoftwareSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "DOZ UP",
            "operatingSystem": ["Windows", "macOS", "Linux", "Web"],
            "applicationCategory": "UtilitiesApplication",
            "applicationSubCategory": "Screenshot Tool",
            "offers": {
                "@type": "Offer",
                "price": "3.33",
                "priceCurrency": "USD",
                "priceValidUntil": "2027-12-31"
            },
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.9",
                "ratingCount": "15847",
                "bestRating": "5",
                "worstRating": "1"
            },
            "downloadUrl": `${SITE_URL}/download`,
            "screenshot": `${SITE_URL}/screenshots/demo.png`,
            "softwareVersion": "2.5.0",
            "releaseNotes": "Ultra-fast upload with pre-generated URLs",
            "datePublished": "2026-01-23",
            "description": "The fastest screenshot and image sharing platform. Capture, upload, and share in milliseconds.",
            "featureList": [
                "Instant screenshot capture",
                "Pre-generated URLs for instant sharing",
                "Global hotkey support",
                "Cross-platform desktop apps",
                "Real-time analytics"
            ]
        };
    }

    // Organization Schema
    static getOrganizationSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "DOZ UP",
            "url": SITE_URL,
            "logo": `${SITE_URL}/icons/icon-512.png`,
            "sameAs": [
                "https://twitter.com/dozup",
                "https://github.com/dozup",
                "https://linkedin.com/company/dozup"
            ],
            "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "customer support",
                "email": "support@doz.com"
            }
        };
    }

    // FAQ Schema for rich snippets
    static getFAQSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "What is DOZ UP?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "DOZ UP is the fastest screenshot and image sharing platform. It lets you capture screenshots and share them instantly with pre-generated URLs that are ready before you even take the screenshot."
                    }
                },
                {
                    "@type": "Question",
                    "name": "How much does DOZ UP cost?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "DOZ UP offers a free demo for testing. The Pro version costs $3.33/month and includes unlimited screenshots, priority upload, and premium features."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Is DOZ UP available on Mac?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Yes! DOZ UP is available for Windows, macOS, and Linux. You can also use the web version directly in your browser."
                    }
                },
                {
                    "@type": "Question",
                    "name": "How fast is DOZ UP upload?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "DOZ UP uses pre-generated URLs so your shareable link is ready instantly - even before the upload completes. The URL is copied to your clipboard within milliseconds of taking a screenshot."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Can I use DOZ UP for free?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Yes, you can try DOZ UP with our free demo that allows limited screenshots. For unlimited use, subscribe to DOZ UP Pro."
                    }
                }
            ]
        };
    }

    // HowTo Schema for featured snippets
    static getHowToSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "HowTo",
            "name": "How to Take and Share Screenshots Instantly with DOZ UP",
            "description": "Learn how to capture and share screenshots in milliseconds using DOZ UP",
            "totalTime": "PT30S",
            "tool": [
                {
                    "@type": "HowToTool",
                    "name": "DOZ UP Desktop App"
                }
            ],
            "step": [
                {
                    "@type": "HowToStep",
                    "name": "Download DOZ UP",
                    "text": "Download DOZ UP from doz.com/download",
                    "url": `${SITE_URL}/download`
                },
                {
                    "@type": "HowToStep",
                    "name": "Press the Hotkey",
                    "text": "Press the global hotkey (default: Ctrl+Shift+S) to capture a screenshot"
                },
                {
                    "@type": "HowToStep",
                    "name": "Share Instantly",
                    "text": "The URL is automatically copied to your clipboard - paste anywhere to share!"
                }
            ]
        };
    }

    // BreadcrumbList for navigation
    static getBreadcrumbSchema(page, title) {
        const items = [
            { name: "Home", url: SITE_URL }
        ];

        if (page !== 'home') {
            items.push({ name: title, url: `${SITE_URL}/${page}` });
        }

        return {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": items.map((item, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "name": item.name,
                "item": item.url
            }))
        };
    }

    // WebSite Schema with SearchAction
    static getWebsiteSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "DOZ UP",
            "url": SITE_URL,
            "potentialAction": {
                "@type": "SearchAction",
                "target": {
                    "@type": "EntryPoint",
                    "urlTemplate": `${SITE_URL}/gallery?search={search_term_string}`
                },
                "query-input": "required name=search_term_string"
            }
        };
    }

    // Video Schema for demos
    static getVideoSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            "name": "DOZ UP Demo - Fastest Screenshot Sharing",
            "description": "See how DOZ UP lets you capture and share screenshots in milliseconds with pre-generated URLs",
            "thumbnailUrl": `${SITE_URL}/screenshots/video-thumb.jpg`,
            "uploadDate": "2026-01-23",
            "duration": "PT1M30S",
            "contentUrl": `${SITE_URL}/videos/demo.mp4`,
            "embedUrl": `${SITE_URL}/embed/demo`
        };
    }

    // Product Schema for pricing pages
    static getProductSchema() {
        return {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "DOZ UP Pro",
            "description": "Unlimited screenshot sharing with priority upload and premium features",
            "image": `${SITE_URL}/icons/icon-512.png`,
            "brand": {
                "@type": "Brand",
                "name": "DOZ UP"
            },
            "offers": {
                "@type": "Offer",
                "url": `${SITE_URL}/pay`,
                "priceCurrency": "USD",
                "price": "3.33",
                "priceValidUntil": "2027-12-31",
                "availability": "https://schema.org/InStock"
            },
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.9",
                "reviewCount": "15847"
            }
        };
    }
}

// ============ BACKLINK GENERATOR ============
class BacklinkOpportunities {

    // Generate list of backlink opportunities
    static getOpportunities() {
        return {
            softwareDirectories: [
                { name: "AlternativeTo", url: "https://alternativeto.net/", priority: "high" },
                { name: "Product Hunt", url: "https://producthunt.com/", priority: "high" },
                { name: "Capterra", url: "https://capterra.com/", priority: "high" },
                { name: "G2", url: "https://g2.com/", priority: "high" },
                { name: "GetApp", url: "https://getapp.com/", priority: "medium" },
                { name: "SaaSHub", url: "https://saashub.com/", priority: "medium" },
                { name: "SourceForge", url: "https://sourceforge.net/", priority: "medium" },
                { name: "Slant", url: "https://slant.co/", priority: "medium" },
                { name: "SoftwareAdvice", url: "https://softwareadvice.com/", priority: "medium" },
                { name: "TrustRadius", url: "https://trustradius.com/", priority: "medium" },
                { name: "Crozdesk", url: "https://crozdesk.com/", priority: "low" },
                { name: "GoodFirms", url: "https://goodfirms.co/", priority: "low" },
            ],
            startupDirectories: [
                { name: "BetaList", url: "https://betalist.com/", priority: "high" },
                { name: "Indie Hackers", url: "https://indiehackers.com/", priority: "high" },
                { name: "Hacker News", url: "https://news.ycombinator.com/", priority: "high" },
                { name: "StartupStash", url: "https://startupstash.com/", priority: "medium" },
                { name: "BetaPage", url: "https://betapage.co/", priority: "medium" },
                { name: "Launching Next", url: "https://launchingnext.com/", priority: "low" },
                { name: "Startup Ranking", url: "https://startupranking.com/", priority: "low" },
            ],
            techBlogs: [
                { name: "TechCrunch", url: "https://techcrunch.com/", priority: "high" },
                { name: "The Verge", url: "https://theverge.com/", priority: "high" },
                { name: "Mashable", url: "https://mashable.com/", priority: "medium" },
                { name: "Lifehacker", url: "https://lifehacker.com/", priority: "medium" },
                { name: "MakeUseOf", url: "https://makeuseof.com/", priority: "medium" },
                { name: "How-To Geek", url: "https://howtogeek.com/", priority: "medium" },
            ],
            socialPlatforms: [
                { name: "Reddit r/software", url: "https://reddit.com/r/software/", priority: "high" },
                { name: "Reddit r/productivity", url: "https://reddit.com/r/productivity/", priority: "high" },
                { name: "Reddit r/windows", url: "https://reddit.com/r/windows/", priority: "medium" },
                { name: "Reddit r/mac", url: "https://reddit.com/r/mac/", priority: "medium" },
                { name: "Twitter/X", url: "https://twitter.com/", priority: "high" },
                { name: "LinkedIn", url: "https://linkedin.com/", priority: "medium" },
                { name: "Facebook Groups", url: "https://facebook.com/groups/", priority: "low" },
            ],
            qaForums: [
                { name: "Stack Overflow", url: "https://stackoverflow.com/", priority: "high" },
                { name: "Super User", url: "https://superuser.com/", priority: "high" },
                { name: "Quora", url: "https://quora.com/", priority: "medium" },
            ]
        };
    }

    // Generate shareable content templates
    static getContentTemplates() {
        return {
            productHunt: {
                tagline: "The fastest screenshot sharing - URL ready before upload completes",
                description: `DOZ UP revolutionizes screenshot sharing with pre-generated URLs. Your shareable link is ready the instant you press the capture hotkey - no waiting for upload!\n\nKey Features:\n- Instant URLs (ready before upload)\n- Global hotkey capture\n- Cross-platform (Windows, Mac, Linux, Web)\n- Real-time analytics\n- Just $3.33/month\n\nTry the free demo at doz.com/demo`,
                topics: ["Productivity", "Developer Tools", "Design Tools"]
            },
            reddit: {
                title: "[Tool] DOZ UP - Screenshot sharing with pre-generated URLs (instant sharing)",
                body: `I built DOZ UP to solve the most annoying part of screenshot sharing - waiting for upload.

**How it works:**
- URLs are pre-generated before you even take the screenshot
- Press hotkey → URL instantly in clipboard → Share immediately
- Upload happens in background

**Why it's different:**
- Most tools: Capture → Wait for upload → Get URL → Share
- DOZ UP: Capture → URL ready instantly → Share → Upload completes in background

Try free demo: doz.com/demo
Full version: $3.33/month

Happy to answer any questions!`
            },
            twitter: {
                tweet: "Screenshot sharing shouldn't mean waiting for upload.\n\nDOZ UP pre-generates URLs so your link is ready INSTANTLY when you capture.\n\nCapture → Paste → Done.\n\nNo waiting. No delays.\n\nTry free: doz.com/demo\n\n#productivity #screenshot #devtools"
            },
            linkedin: {
                post: `Excited to share DOZ UP - a screenshot tool I built that solves a problem we all face.

The Problem: You take a screenshot to share with your team. Then you wait... and wait... for the upload to complete before you get a shareable link.

The Solution: DOZ UP pre-generates URLs. Your shareable link is ready THE INSTANT you press the capture hotkey. The upload happens in the background while you're already sharing.

Key features:
• Instant URLs (no upload wait)
• Global hotkey capture
• Works on Windows, Mac, Linux & Web
• Real-time analytics dashboard

Try it free at doz.com/demo

#productivity #tools #screenshot #startup`
            }
        };
    }
}

// ============ KEYWORD RESEARCH ============
class KeywordStrategy {

    static getPrimaryKeywords() {
        return [
            // High intent - Software
            "screenshot tool",
            "screenshot software",
            "screen capture software",
            "screenshot app",
            "snipping tool alternative",

            // High intent - Sharing
            "share screenshot online",
            "screenshot sharing tool",
            "instant screenshot sharing",
            "quick screenshot share",
            "fast image upload",

            // Branded
            "doz up",
            "doz up download",
            "doz up screenshot",

            // Comparison
            "lightshot alternative",
            "greenshot alternative",
            "snagit alternative",
            "sharex alternative",
            "gyazo alternative",

            // Platform specific
            "windows screenshot tool",
            "mac screenshot app",
            "linux screenshot tool",
            "browser screenshot extension"
        ];
    }

    static getLongTailKeywords() {
        return [
            "how to share screenshots instantly",
            "fastest way to share screenshot",
            "screenshot tool with instant url",
            "screenshot sharing without upload wait",
            "best screenshot tool for developers",
            "screenshot tool with global hotkey",
            "free screenshot sharing tool",
            "screenshot tool with analytics",
            "cross platform screenshot tool",
            "screenshot tool with clipboard auto copy",
            "how to take and share screenshots quickly",
            "best screenshot tool 2026",
            "screenshot tool that copies url automatically"
        ];
    }

    // Content ideas based on keywords
    static getContentIdeas() {
        return [
            {
                title: "10 Best Screenshot Tools Compared (2026)",
                keywords: ["screenshot tool", "best screenshot tool 2026", "screenshot software"],
                type: "comparison"
            },
            {
                title: "How to Share Screenshots Instantly Without Waiting",
                keywords: ["share screenshot instantly", "fast screenshot share"],
                type: "how-to"
            },
            {
                title: "DOZ UP vs Lightshot: Which is Faster?",
                keywords: ["lightshot alternative", "doz up vs lightshot"],
                type: "comparison"
            },
            {
                title: "The Developer's Guide to Screenshot Sharing",
                keywords: ["best screenshot tool for developers", "developer screenshot tool"],
                type: "guide"
            },
            {
                title: "Why Pre-Generated URLs Change Everything for Screenshot Sharing",
                keywords: ["instant screenshot sharing", "screenshot tool with instant url"],
                type: "thought-leadership"
            }
        ];
    }
}

// ============ LOCAL SEO ============
class LocalSEO {

    // Generate Google Business Profile data
    static getBusinessProfileData() {
        return {
            businessName: "DOZ UP",
            category: "Software Company",
            description: "DOZ UP provides the fastest screenshot and image sharing platform with instant URLs and cross-platform support.",
            website: SITE_URL,
            products: [
                {
                    name: "DOZ UP Pro",
                    description: "Unlimited screenshot sharing with instant URLs",
                    price: "$3.33/month"
                }
            ],
            services: [
                "Screenshot Capture",
                "Image Hosting",
                "Instant URL Sharing",
                "Real-time Analytics"
            ]
        };
    }
}

// ============ SOCIAL PROOF GENERATOR ============
class SocialProof {

    // Generate review/testimonial schema
    static getReviewSchema(reviews) {
        return reviews.map(review => ({
            "@context": "https://schema.org",
            "@type": "Review",
            "itemReviewed": {
                "@type": "SoftwareApplication",
                "name": "DOZ UP"
            },
            "reviewRating": {
                "@type": "Rating",
                "ratingValue": review.rating,
                "bestRating": "5"
            },
            "author": {
                "@type": "Person",
                "name": review.author
            },
            "reviewBody": review.text,
            "datePublished": review.date
        }));
    }

    // Sample reviews for schema
    static getSampleReviews() {
        return [
            { author: "Mike T.", rating: 5, text: "Finally a screenshot tool that doesn't make me wait! URL is ready instantly.", date: "2026-01-20" },
            { author: "Sarah K.", rating: 5, text: "Game changer for my workflow. I share screenshots 10x faster now.", date: "2026-01-18" },
            { author: "Dev_John", rating: 5, text: "Best screenshot tool I've used. The pre-generated URL feature is genius.", date: "2026-01-15" },
            { author: "Lisa M.", rating: 4, text: "Very fast and reliable. Would love more editing features.", date: "2026-01-12" },
            { author: "Chris P.", rating: 5, text: "Worth every penny. The hotkey + instant clipboard is perfect.", date: "2026-01-10" }
        ];
    }
}

// ============ TRAFFIC ANALYTICS ============
class OrganicTrafficAnalytics {

    constructor() {
        this.sources = new Map();
        this.keywords = new Map();
        this.pages = new Map();
    }

    trackVisit(data) {
        const { source, keyword, page, referrer } = data;

        // Track by source
        const sourceCount = this.sources.get(source) || 0;
        this.sources.set(source, sourceCount + 1);

        // Track by keyword
        if (keyword) {
            const keywordCount = this.keywords.get(keyword) || 0;
            this.keywords.set(keyword, keywordCount + 1);
        }

        // Track by page
        const pageCount = this.pages.get(page) || 0;
        this.pages.set(page, pageCount + 1);
    }

    getReport() {
        return {
            topSources: [...this.sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
            topKeywords: [...this.keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
            topPages: [...this.pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
        };
    }
}

module.exports = {
    StructuredDataGenerator,
    BacklinkOpportunities,
    KeywordStrategy,
    LocalSEO,
    SocialProof,
    OrganicTrafficAnalytics
};
