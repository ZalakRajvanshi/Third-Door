export interface Dossier {
  years: number | null;
  seniority: string | null;
  overview: string | null; // career arc summary
  tagline: string | null; // one-liner / search summary
  bestFor: string[];
  notFor: string[];
  products: { name: string; impact?: string; description?: string }[];
  roles: { title: string; company: string; years?: string; metric?: string }[];
  scale: string | null;
  skills: string[];
  tools: string[];
  domains: string[];
  education: { degree?: string; field?: string; institution: string; year?: string | number }[];
  flags: string[];
}

export interface UiPerson {
  id: string;
  name: string;
  headline: string | null;
  current_title: string | null;
  company: string | null;
  location: string | null;
  summary?: string | null;
  skills: string[];
  experience?: { company: string; title: string }[];
  education?: { school: string; degree?: string }[];
  social_links?: { type: string; url: string }[];
  dossier?: Dossier;
}

export interface RankedPerson {
  person: UiPerson;
  score: number;
  why: string[];
  concerns: string[];
  vetted?: boolean; // true = AI-vetted top; false = relevant tail (cheap-scored)
}
