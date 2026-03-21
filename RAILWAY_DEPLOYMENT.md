# Railway Deployment Guide - OrthoIQ Agents

## Production Secrets Generated

**IMPORTANT: Save these securely - they are unique to your deployment**

```bash
JWT_SECRET=G9bTx7OB6vaO76I2e83Gt7n2sKPz7v5038hNsifKUjg=
API_KEY=2946f4d185afdfb9cec20c63293aa6408eae05e3d093f62e318408dd0e68def7
ENCRYPTION_KEY=11a3154688bd167a71979555adfd0a511bc1eba42f7980f2817f54286962eaf7
```

## Step-by-Step Railway Deployment

### 1. Railway Project Setup

1. Go to [railway.app](https://railway.app) and login
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select the `orthoiq-agents` repository
4. Select the `main` branch

### 2. Build Configuration

Configure the following in Railway:

- **Install Command**: `npm install`
- **Build Command**: *(leave empty - no build needed)*
- **Start Command**: `npm start`
- **Root Directory**: `/`

### 3. Service Configuration

In Railway dashboard, configure:

- **Service Name**: `orthoiq-agents-api`
- **Region**: `us-west1` (or closest to your users)
- **Memory**: 1GB
- **Restart Policy**: Always
- **Health Check Path**: `/health`
- **Health Check Timeout**: 30 seconds
- **Request Timeout**: 300 seconds

### 4. Environment Variables

Go to **Settings → Variables** and add ALL of these:

#### Critical API Keys
```bash
ANTHROPIC_API_KEY=your-anthropic-api-key-here
```

#### CDP Blockchain Credentials
```bash
CDP_API_KEY_NAME=OrthoIQ-Agents
CDP_API_KEY_ID=265c5c1a-fc17-402d-9ea8-1b2d7de132e4
CDP_API_KEY_PRIVATE_KEY=bE3qf22YdQ3rlpZtJnP0Ba9j72ZFZzZGIEhEE96oQGqZqBoR7+vtjQMxR1V31NJUTZ2h30VBacyZSgQSOeSgkA==
CDP_API_KEY_SECRET=bE3qf22YdQ3rlpZtJnP0Ba9j72ZFZzZGIEhEE96oQGqZqBoR7+vtjQMxR1V31NJUTZ2h30VBacyZSgQSOeSgkA==
CDP_WALLET_SECRET=MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgyJkEDUI0je9AmaVYrgy/BNTuFFFBmVo8yZZnRg0ykeGhRANCAASRueQ/mGHf1ptXOaEnBkjfncv0Bj/xhtsenIMy3V9qQW0Iz5ey1j04vCnw0YTNLtDCH5jQebJz3jmO5L0gMZdQ
```

#### Production Configuration
```bash
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
```

#### Blockchain Configuration (Mock Mode Initially)
```bash
NETWORK_ID=base-sepolia
ENABLE_BLOCKCHAIN=true
MOCK_BLOCKCHAIN_RESPONSES=true
TOKEN_CONTRACT_ADDRESS=
BASE_RPC_URL=https://sepolia.base.org
```

#### Security (Generated Above)
```bash
JWT_SECRET=G9bTx7OB6vaO76I2e83Gt7n2sKPz7v5038hNsifKUjg=
API_KEY=2946f4d185afdfb9cec20c63293aa6408eae05e3d093f62e318408dd0e68def7
ENCRYPTION_KEY=11a3154688bd167a71979555adfd0a511bc1eba42f7980f2817f54286962eaf7
```

#### Performance & Models
```bash
ENABLE_CACHE=true
CACHE_TTL=86400
MAX_TOKENS=2000
CLAUDE_MODEL=claude-sonnet-4-6
FAST_MODEL=claude-haiku-4-5-20251001
MAX_PARALLEL_AGENTS=5
ENABLE_SCOPE_VALIDATION=true
```

#### Research Agent
```bash
DATABASE_URL=postgresql://user:password@host/dbname  # Neon serverless PostgreSQL
PUBMED_API_KEY=your_pubmed_api_key                    # NCBI E-utilities API key
ENABLE_RESEARCH_AGENT=true                            # Set false to disable
```

#### Token Economics
```bash
INITIAL_TOKEN_SUPPLY=1000000
BASE_REWARD_AMOUNT=1
MAX_REWARD_MULTIPLIER=50
```

#### Recovery Metrics
```bash
DEFAULT_RECOVERY_WEEKS=16
PAIN_REDUCTION_TARGET=70
FUNCTIONAL_IMPROVEMENT_TARGET=80
PATIENT_SATISFACTION_TARGET=8
```

**IMPORTANT**: Mark these as **Sensitive** in Railway:
- ANTHROPIC_API_KEY
- CDP_API_KEY_PRIVATE_KEY
- CDP_API_KEY_SECRET
- CDP_WALLET_SECRET
- JWT_SECRET
- API_KEY
- ENCRYPTION_KEY
- DATABASE_URL
- PUBMED_API_KEY

### 5. Deploy

Click **"Deploy"** in Railway dashboard.

### 6. Monitor Deployment

Watch the build logs for:

```
✓ npm install completes
✓ npm start executes
🚀 Initializing OrthoIQ Agent System
✅ Blockchain connection established
⚠️ CDP Account Manager initialization (may warn in mock mode)
✅ Database migrations complete (or ⚠️ if no DATABASE_URL)
👥 Creating 5 specialist agents
✓ Research Pioneer - medical literature research
✅ OrthoIQ Agent System initialized
🌐 Server listening on port 3000
```

Railway will assign a URL like: `https://orthoiq-agents-production.up.railway.app`

### 7. Post-Deployment Testing

Once deployed, run these tests:

#### Test Health Endpoint
```bash
export API_URL=https://YOUR-RAILWAY-URL.up.railway.app

curl $API_URL/health
# Expected: {"status":"healthy","agents":5,"blockchain":"connected"}
```

#### Test Scope Validation (Out-of-Scope)
```bash
curl -X POST $API_URL/triage \
  -H "Content-Type: application/json" \
  -d '{"rawQuery":"I have heart palpitations"}'
# Expected: Rejection with out_of_scope category
```

#### Test Scope Validation (In-Scope)
```bash
curl -X POST $API_URL/triage \
  -H "Content-Type: application/json" \
  -d '{"primaryComplaint":"knee pain after running","age":32,"painLevel":6}'
# Expected: Success with triage response
```

#### Test Research Trigger
```bash
curl -X POST $API_URL/research/trigger \
  -H "Content-Type: application/json" \
  -d '{"consultationId":"test-1","caseData":{"primaryComplaint":"knee pain"},"consultationResult":{"triage":{}}}'
# Expected: {"success":true,"consultationId":"test-1","status":"pending","estimatedSeconds":15}
```

#### Test Research Poll
```bash
curl $API_URL/research/test-1
# Expected: {"status":"pending","estimatedSeconds":...} or {"status":"complete",...}
```

#### Test Fast Mode Consultation
```bash
time curl -X POST $API_URL/consultation \
  -H "Content-Type: application/json" \
  -d '{
    "caseData": {
      "primaryComplaint":"shoulder pain when lifting",
      "age":45,
      "painLevel":6
    },
    "mode":"fast"
  }'
# Expected: Response in <5 seconds
```

## Success Criteria

- ✅ Deployment succeeds without errors
- ✅ Health endpoint returns 200 OK
- ✅ All 5 agents initialize successfully
- ✅ Research agent initializes (when ENABLE_RESEARCH_AGENT=true)
- ✅ Database migrations run (when DATABASE_URL is set)
- ✅ Scope validation working correctly
- ✅ Fast mode responds in <5 seconds
- ✅ Normal consultations complete in <90 seconds
- ✅ Mock blockchain transactions working

## Next Steps

Once Railway deployment is complete and tested, you can proceed with Phase 3: Base Sepolia Migration.

The smart contract files will be ready in the `contracts/` directory.

## Troubleshooting

**If deployment fails:**
- Check Railway logs for specific errors
- Verify all environment variables are set correctly
- Ensure no typos in variable names

**If agents fail to initialize:**
- Check that ANTHROPIC_API_KEY is valid
- Verify LOG_LEVEL is set to "info" or "debug" for more details

**If blockchain errors occur:**
- Confirm MOCK_BLOCKCHAIN_RESPONSES=true is set
- Check CDP credentials are correctly copied

## Rollback

If issues occur, you can rollback in Railway:
1. Go to **Deployments** tab
2. Select a previous working deployment
3. Click **"Redeploy"**
