# Domain & Hosting Research (March 2026)

## Domain Registration

### Recommendations
1. **Spaceship** — ~$95-101 for 10 years (cheapest)
2. **Porkbun** — ~$111 for 10 years (all-inclusive, zero hassle)
3. **Cloudflare** — ~$104 for 10 years (at-cost, best DNS/CDN/security)

### Recommended Setup
- **Domain:** Spaceship or Porkbun
- **DNS:** Cloudflare free tier (200 records, free SSL on all subdomains)
- **Hosting:** Separate from registrar — just point DNS

### Full Domain Comparison

| Feature | Spaceship | Cloudflare | Porkbun | Hostinger | NameSilo | GoDaddy |
|---|---|---|---|---|---|---|
| 10-Yr .com Cost | ~$95–101 | ~$104 | ~$111 | ~$141 | ~$111–140 | ~$170–200 |
| WHOIS Privacy | Free | Free | Free | Free | Free | $9.99/yr |
| SSL | Free redirect | Free (proxy) | Free (LE) | Free (hosting) | Not included | Paid |
| DNS Management | Free (basic) | Free (best) | Free (CF-powered) | Free (hosting) | Free | Free (basic) |
| Subdomain Limit | No cap | 200 records (free) | No cap | Unlimited | No cap | 500 records |
| Email Forwarding | Free | Free | Free | Free (basic) | Free | Paid |
| Best For | Cheapest | DNS+CDN+Security | All-inclusive | Bundled hosting | Bulk domains | Brand recognition |

### Key Note
- Verisign raising .com wholesale prices by up to 7%/yr starting late 2026 — lock in now
- Don't transfer to a host later — just point DNS to keep cheap renewal rate

---

## Hosting Options

### Current Setup
- Running 2 sites on **HelioHost Tommy** (free, one-time $2 donation)
- Tommy: 10 domains, 99.62% uptime, multi-language (PHP, Python, Ruby, Java, Go, Perl)

### Shared Hosting Options

| Feature | HelioHost Johnny | HelioHost Morty | Namecheap Stellar |
|---|---|---|---|
| Price | FREE | $1/mo ($12/yr) | ~$1.98/mo (~$24/yr) |
| Renewal | Free | $1/mo | **$4.48/mo (~$54/yr)** |
| Sites | 5 domains | 15 domains | 3 sites |
| Storage | Shared pool | **1GB base (7GB max for +$30)** | 20GB SSD |
| Bandwidth | Unlimited | Unlimited | Unlimited |
| Uptime | ~98% | 100% | 99.9% SLA |
| Languages | PHP, Python, Perl, Ruby, Java, Go | PHP, Python, Perl, Ruby, Java, Go | PHP only |
| Control Panel | Plesk | Plesk | cPanel |

### HelioHost Morty — Fine Print
- **Base $1/mo includes:** 200GB memory/day, 10k CPU/day
- **Storage: 1GB base, max 7GB** ($5 per extra 1GB, hard ceiling)
- **Overages:** $0.0005/GB memory, $0.005 per 1k CPU over limits
- **Monthly bill cap:** $25/mo maximum
- Most lightweight sites stay at $1/mo (WordPress, Node, Laravel all $1/mo under 10k hits/day)
- Django/Flask load not benchmarked yet

### VPS Options (2GB+ for databases)

| Feature | RackNerd 2GB | BuyVM | Hetzner CX22 | IONOS |
|---|---|---|---|---|
| Price | **$18.29/yr** | $3.50/mo ($42/yr) | €3.79/mo (~$46/yr) | $2/mo ($24/yr)* |
| Renewal | **Same price** | Same | Same | Verify at checkout |
| RAM | 2GB | 1GB | **4GB** | 1GB |
| CPUs | 1 vCPU | 1 | **2 vCPU** | 1 |
| Storage | **40GB SSD** | 20GB SSD | 40GB NVMe | 10GB NVMe |
| Bandwidth | 3.5TB/mo | **Unmetered** | 20TB/mo | **Unmetered** |
| Locations | US, EU, Asia | US, EU | Germany, Finland | US, EU |
| Panel | SolusVM | Free DirectAdmin | Hetzner Cloud | IONOS panel |
| Languages | Any | Any | Any | Any |

### RackNerd — Hidden Promo Deals (not on main site!)
- Main website pricing is expensive ($23+/mo)
- Cheap deals are on **hidden promo pages** from Black Friday, New Year, LEB exclusives
- Use [RacknerdTracker.com](https://racknerdtracker.com/) to find all active deals
- Direct links to active deals (March 2026):
  - 1GB VPS: $10.29/yr — https://racknerdtracker.com/
  - 2GB VPS: $18.29/yr — https://my.racknerd.com/cart.php?a=add&pid=904
  - 3.5GB VPS: $32.49/yr — https://my.racknerd.com/cart.php?a=add&pid=905
- **Prices lock in for life** — renewal stays the same

### Active Promos (March 2026)
| Provider | Deal |
|---|---|
| RackNerd | New Year 2026 sale — from $11.29/yr via hidden pages |
| Namecheap | Code `TWINKLENS` — up to 65% off shared hosting, valid till Mar 31 |
| IONOS | Auto-applied — VPS from $1/mo for new customers |
| Hetzner | $20 free credit for new users with code `vDGFEz7FaiSu` |
| BuyVM | No promos — already at-cost pricing |

---

## VPS vs Shared Hosting Analysis

### 1GB VPS Reality (why 2GB minimum for databases)
| Component | RAM Usage |
|---|---|
| Ubuntu OS | ~150-200MB |
| Nginx | ~50-100MB |
| MySQL/PostgreSQL | ~200-400MB |
| Small app | ~50-150MB each |
| **Total before apps** | **~500-700MB** |

With 1GB: constant swap, sluggish. **2GB minimum if running databases.**
Exception: SQLite needs ~0MB extra (file-based) — 1GB works fine with SQLite.

### VPS Admin Overhead (hidden cost)
| Task | Frequency | Time |
|---|---|---|
| OS security updates | Monthly | 15-30 min |
| Monitoring disk/memory | Weekly | 10 min |
| SSL cert debugging | Every few months | 30 min-2 hrs |
| Random breakage | Occasionally | 1-6 hrs |
| Backup management | Monthly | 15 min |

Estimated: 2-4 hours/month of unpaid sysadmin work.

### Morty vs RackNerd 2GB — Key Tradeoff
| | Morty ($12/yr) | RackNerd 2GB ($18.29/yr) |
|---|---|---|
| Storage | **1GB (max 7GB for +$30)** | **40GB SSD** |
| Admin work | Zero | 2-4 hrs/month |
| Overage risk | Up to $25/mo | None — fixed |
| Root access | No | Yes |
| Docker/custom daemons | No | Yes |
| Predictability | Variable | Fixed forever |

---

## Decision Framework
- **If sites are small, no custom daemons needed:** Morty at $12/yr (but watch the 7GB storage cap)
- **If you need storage, databases, or full control:** RackNerd 2GB at $18.29/yr
- **If you want power and zero worry:** Hetzner CX22 at ~$46/yr (4GB RAM, 2 vCPU)
- **Best of both worlds:** Keep Tommy (free) for existing sites + RackNerd for new projects (~$18/yr total)

## Suggested Full Stack
```
Domain:    Spaceship/Porkbun     (~$95-111 / 10yr)
DNS:       Cloudflare free tier
Hosting:   HelioHost Morty ($12/yr) OR RackNerd 2GB VPS ($18.29/yr)
SSL:       Cloudflare proxy (free) or Certbot (free)
Email:     Zoho Mail free tier or Google Workspace
```
