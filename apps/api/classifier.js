const CATEGORY_RULES = [
  { category: "functional", confidence: 0.92, domains: ["github.com", "docs.google.com", "drive.google.com", "calendar.google.com", "stackoverflow.com", "developer.mozilla.org", "npmjs.com"] },
  { category: "functional", confidence: 0.86, title: /\b(tutorial|docs?|documentation|course|lecture|guide|how to|api|programming|coding|typescript|javascript|python|react|sqlite)\b/i },
  { category: "fun", confidence: 0.9, domains: ["netflix.com", "hulu.com", "disneyplus.com", "twitch.tv"] },
  { category: "fun", confidence: 0.78, title: /\b(lore|explained|reaction|compilation|minecraft|gameplay|meme|memes|trailer)\b/i },
  { category: "mixed", confidence: 0.65, domains: ["youtube.com", "reddit.com", "x.com", "twitter.com", "instagram.com"] }
];

export const VALID_CATEGORIES = new Set(["functional", "fun", "mixed", "unknown"]);

export function normalizeCategory(value) {
  return VALID_CATEGORIES.has(value) ? value : "unknown";
}

export function parseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname || "/";
    return {
      domain: hostname,
      path,
      siteSection: inferSiteSection(hostname, path)
    };
  } catch {
    return { domain: "unknown", path: "/", siteSection: "unknown" };
  }
}

export function inferSiteSection(domain, path) {
  if (domain.endsWith("youtube.com")) {
    if (path === "/watch") return "watch";
    if (path.startsWith("/shorts")) return "shorts";
    if (path.startsWith("/results")) return "search";
    if (path.startsWith("/feed/subscriptions")) return "subscriptions";
  }

  if (domain.endsWith("reddit.com")) {
    const match = path.match(/^\/r\/([^/]+)/);
    if (match) return `r/${match[1]}`;
  }

  const first = path.split("/").filter(Boolean)[0];
  return first || "home";
}

export function classifyActivity({ domain, title }, corrections = []) {
  const domainCorrection = corrections.find((item) => item.matcher_type === "domain" && domain.endsWith(item.matcher_value));
  if (domainCorrection) {
    return { category: domainCorrection.category, confidence: 1, reason: "user domain correction" };
  }

  const titleCorrection = corrections.find((item) => {
    return item.matcher_type === "title_contains" && title?.toLowerCase().includes(item.matcher_value.toLowerCase());
  });
  if (titleCorrection) {
    return { category: titleCorrection.category, confidence: 1, reason: "user title correction" };
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.domains?.some((ruleDomain) => domain === ruleDomain || domain.endsWith(`.${ruleDomain}`))) {
      return { category: rule.category, confidence: rule.confidence, reason: "domain rule" };
    }

    if (rule.title?.test(title || "")) {
      return { category: rule.category, confidence: rule.confidence, reason: "title rule" };
    }
  }

  return { category: "unknown", confidence: 0.2, reason: "fallback" };
}
