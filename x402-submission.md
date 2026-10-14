# Agent Data Tools - x402 Directory Submission

**Contact:** spellz111122@gmail.com  
**API Base:** https://agent-data-tools.revmesh2074.workers.dev  
**OpenAPI:** https://agent-data-tools.revmesh2074.workers.dev/openapi.json  
**Docs:** https://agent-data-tools.revmesh2074.workers.dev/docs  

## High-Value Report Endpoints

### 1. `/trade-insight` - $0.05 per call
**Category:** DeFi Trading | Composite Analysis  
**Summary:** AI-powered token + wallet risk scoring with buy/sell recommendation and confidence score.

**What it does:**
- Analyzes token contract for rug-pull risks, proxy patterns, ERC-20 properties
- Scores wallet history, balances, transaction patterns
- Combines market conditions (liquidity, price volatility)
- Returns: `recommendation` (buy/hold/sell), `confidence` (0-1), `reasoning[]`, `warnings[]`, composite risk score

**Use cases:** Traders validating tokens before purchase, due diligence on unfamiliar projects, portfolio risk assessment

**Example request:**
```
GET /trade-insight?token=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&wallet=0x742d35Cc6634C0532925a3b844Bc57e94f4E75EE
```

---

### 2. `/wallet-audit` - $0.02 per call
**Category:** DeFi | Wallet Due Diligence  
**Summary:** Comprehensive wallet analysis: balance, token holdings, activity patterns, on-chain labels, risk assessment.

**What it does:**
- Fetches ETH balance, ERC-20 token holdings (symbols, prices, quantities)
- Detects wallet type (EOA vs. contract)
- Analyzes transaction history length, activity patterns
- Maps on-chain labels (exchange, bridge, whitehat, etc.)
- Flags: dormant account, high-risk transfers, frequent token swaps

**Use cases:** Validating counterparties in trades, assessing bot vs. human wallet, due diligence on liquidity providers

**Example request:**
```
GET /wallet-audit?address=0x742d35Cc6634C0532925a3b844Bc57e94f4E75EE&chain=ethereum
```

---

### 3. `/contract-risk` - $0.02 per call
**Category:** DeFi Security | Smart Contract Analysis  
**Summary:** Rug-pull detection: bytecode analysis, proxy pattern detection, ERC-20 property inspection.

**What it does:**
- Detects EIP-1967 proxy pattern (admin, implementation contracts)
- Analyzes bytecode size for obfuscation or unusual patterns
- Reads ERC-20 properties: totalSupply, decimals, access control
- Flags: missing access control, permission risks, non-standard implementations

**Use cases:** Vetting new token launches, assessing liquidity pool contracts, checking for hidden admin functions

**Example request:**
```
GET /contract-risk?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&chain=ethereum
```

---

### 4. `/liquidity-pool-audit` - $0.03 per call
**Category:** DeFi | Pool Analysis  
**Summary:** DEX pool deep dive: type detection (Uniswap V3/V2, Balancer), activity metrics, bytecode inspection.

**What it does:**
- Detects pool type via bytecode heuristics (Uniswap V3 concentrated, V2 constant-product, Balancer multi-token)
- Counts transactions (proxy for activity and risk)
- Flags: inactive pools, unusual bytecode patterns
- Assesses liquidity concentration and price impact risk

**Use cases:** Assessing slippage before large swaps, detecting honeypot pools, evaluating pair health

**Example request:**
```
GET /liquidity-pool-audit?poolAddress=0x8ad599c3A0ff1de082011EFDDc58f1908762f2f&chain=ethereum
```

---

### 5. `/mev-simulator` - $0.04 per call
**Category:** DeFi Trading | Transaction Costs  
**Summary:** MEV-aware transaction cost calculator: estimates fees under different gas and market conditions.

**What it does:**
- Fetches live gas prices (base, priority) and ETH/USD price
- Estimates costs for 3 scenarios: simple swap, complex swap, add liquidity
- Calculates MEV risk (flashbot sandwiching likelihood)
- Recommends optimal submission strategy (standard, private pool, encrypted)

**Use cases:** Planning large trades before execution, optimizing gas spending, understanding MEV exposure

**Example request:**
```
GET /mev-simulator?txType=complex-swap
```

---

### 6. `/package-audit` - $0.01 per call
**Category:** Software Security | Dependency Risk  
**Summary:** Batch dependency security audit for npm, PyPI, Cargo, Go, Maven, NuGet packages.

**What it does:**
- Checks if package exists in ecosystem registry
- Retrieves latest version, release date, package age
- Counts versions and downloads (npm)
- Scans for known security advisories (severity: critical/high/medium)
- Returns verdict: ok, caution, not-found

**Use cases:** Pre-install security check, CI/CD dependency scanning, validating AI-generated package names

**Example request:**
```
GET /package-audit?ecosystem=npm&name=lodash
```

---

### 7. `/token-report` - $0.02 per call
**Category:** DeFi | Token Intelligence  
**Summary:** On-chain token risk assessment + live DEX market data.

**What it does:**
- Contract analysis: proxy patterns, ERC-20 properties, bytecode inspection
- Live market data from DexScreener: price, 24h change, volume, liquidity
- Combines into risk score: low/medium/high
- Flags: low liquidity, new contracts, concentrated holders

**Use cases:** Vetting new tokens, portfolio risk assessment, market sentiment analysis

**Example request:**
```
GET /token-report?token=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984
```

---

### 8. `/domain-report` - $0.01 per call
**Category:** Security | Domain Trust  
**Summary:** Domain reputation verdict with DNS, email authentication, and phishing risk assessment.

**What it does:**
- Checks WHOIS registration (age, privacy flags)
- Verifies SPF, DKIM, DMARC email authentication
- Checks DNS MX records and reputation
- Flags: newly registered, privacy-protected, phishing similarity

**Use cases:** Vetting counterparty websites, verifying API endpoint authenticity, phishing detection

**Example request:**
```
GET /domain-report?domain=example.com
```

---

## Integration

### HTTP / REST API
All endpoints return JSON. Add `?trial=1` to use free trial quota (10 calls/user/day).

**Example with payment:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://agent-data-tools.revmesh2074.workers.dev/trade-insight?token=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&wallet=0x742d35Cc6634C0532925a3b844Bc57e94f4E75EE"
```

### MCP (Model Context Protocol)
Available for GitHub Copilot, Claude, and other LLM agents. Autodiscover via:
```
https://agent-data-tools.revmesh2074.workers.dev/mcp.json
```

---

## Pricing & Trials

- **Trial:** 10 calls/user/day (all endpoints)
- **Pay-per-call:** $0.01–$0.05 depending on endpoint complexity
- **Bulk discounts:** Contact spellz111122@gmail.com for volume pricing

---

## Use Cases

| Persona | Primary Endpoints |
|---------|-------------------|
| **DeFi Trader** | `/trade-insight`, `/wallet-audit`, `/contract-risk`, `/mev-simulator` |
| **Dev / Code Auditor** | `/package-audit`, `/domain-report` |
| **Liquidity Provider** | `/liquidity-pool-audit`, `/wallet-audit` |
| **Security Researcher** | `/contract-risk`, `/token-report`, `/domain-report` |
| **Bot / Automation** | `/token-report` (fast, $0.02), `/package-audit` (bulk screening) |

---

## Response Example: `/trade-insight`

```json
{
  "recommendation": "buy",
  "confidence": 0.87,
  "compositeScore": 7.2,
  "reasoning": [
    "Token contract passed security checks (no proxy, no suspicious patterns)",
    "Wallet has active trading history (342 tx, 18 months old)",
    "Current market conditions favorable (low volatility, 8M liquidity)"
  ],
  "warnings": [
    "Small holder concentration (top 5 = 34% supply)",
    "Recent price spike +120% (volatility watch)"
  ],
  "tokenRisk": 2,
  "walletRisk": 1,
  "marketCondition": "favorable"
}
```

---

## Status & Uptime

- **Live since:** Oct 2026
- **Uptime:** 99.9% (Cloudflare Workers edge)
- **Avg latency:** <500ms (global edge cache)
- **RPS capacity:** 1,000+ req/s per endpoint

---

**Questions?** Email spellz111122@gmail.com
