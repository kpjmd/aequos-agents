# OrthoIQ Agents - TODO

## ✅ Recently Completed (v0.5.0 - 2026-01-06)

### Railway Deployment & Blockchain Integration
- [x] Generate production security secrets (JWT_SECRET, API_KEY, ENCRYPTION_KEY)
- [x] Create comprehensive Railway deployment guide
- [x] Document all 48 environment variables for production
- [x] Create post-deployment test suite (10 tests)
- [x] Develop ERC20 OrthoIQAgentToken smart contract
- [x] Setup Hardhat infrastructure for Base Sepolia
- [x] Write contract deployment script with Basescan verification
- [x] Write agent authorization script
- [x] Write balance checking script
- [x] Update blockchain-utils.js for real blockchain integration
- [x] Update token-manager.js for real blockchain rewards
- [x] Add mock mode flag support (MOCK_BLOCKCHAIN_RESPONSES)
- [x] Implement graceful fallback mechanisms
- [x] Update package.json with Hardhat dependencies
- [x] Add npm scripts for contract management
- [x] Create implementation summary documentation
- [x] Update CHANGELOG.md for v0.5.0

---

# OrthoIQ Agents - TODO

## High Priority

### Deployment & Infrastructure (Next Steps)
- [ ] **Deploy to Railway** - Follow `RAILWAY_DEPLOYMENT.md` guide
- [ ] **Post-deployment testing** - Run 10 test suite from deployment guide
- [ ] Set up production logging and monitoring
- [ ] Set up error tracking (Sentry or similar)

### Base Sepolia Migration (Phase 3)
- [ ] **Install Hardhat dependencies** - `npm install`
- [ ] **Compile smart contract** - `npm run compile:contract`
- [ ] **Generate deployer wallet** - Save private key securely
- [ ] **Fund deployer wallet** - 0.1 ETH from Base Sepolia faucet
- [ ] **Deploy token contract** - `npm run deploy:contract`
- [ ] **Extract agent wallet addresses** - From Railway logs
- [ ] **Fund agent wallets** - 0.05 ETH each from faucet
- [ ] **Authorize agents as minters** - `npm run authorize:agents`
- [ ] **Update Railway env** - Set TOKEN_CONTRACT_ADDRESS, MOCK_BLOCKCHAIN_RESPONSES=false
- [ ] **Verify on Basescan** - Check mint transactions
- [ ] Test token distribution and prediction staking on testnet

### Future Blockchain Steps
- [ ] Audit token contract (optional but recommended)
- [ ] Deploy to Base Mainnet for production

---

## Medium Priority

### Agent Intelligence Improvements

#### MindMender Smart Routing (Option 2)
**Status**: Option 1 implemented (keyword detection)
**Next Step**: Implement context-aware detection

Create dedicated `shouldIncludeMindMender()` method with:
- Explicit psychological indicators
- Chronic pain detection (>3 months duration)
- Sleep disturbance patterns
- Re-injury/recurring injury detection
- Athlete return-to-sport anxiety
- Post-surgical recovery anxiety
- High pain level threshold (>7/10)

**File**: `src/agents/triage-agent.js`
**Reference**: Lines 744-769, 984-1008

#### Smart Routing Enhancements
- [ ] Improve specialist selection accuracy based on symptom patterns
- [ ] Add specialist load balancing
- [ ] Implement specialist performance scoring

### Prediction Market
- [ ] Add persistent storage for predictions (database or on-chain)
- [ ] Implement prediction accuracy tracking over time
- [ ] Add stake adjustment based on agent reputation
- [ ] Create prediction market analytics dashboard

### Recovery Metrics
- [ ] Add milestone tracking persistence
- [ ] Implement outcome prediction models
- [ ] Create patient progress visualization
- [ ] Add comparative outcome analytics

---

## Low Priority

### Testing & Quality
- [ ] Add comprehensive unit tests for all agents
- [ ] Add integration tests for multi-agent coordination
- [ ] Add end-to-end tests for complete consultation flow
- [ ] Set up CI/CD pipeline

### Documentation
- [ ] Create API documentation (Swagger/OpenAPI)
- [ ] Add agent behavior documentation
- [ ] Create deployment guide
- [ ] Add architecture diagrams

### Features
- [ ] Add real-time consultation status updates (WebSockets)
- [ ] Implement consultation history search
- [ ] Add agent performance leaderboard
- [ ] Create admin dashboard for system monitoring

### Frontend Integration
- [ ] Verify MD review queue workflow
- [ ] Test milestone follow-up UI
- [ ] Add agent response streaming
- [ ] Implement real-time token balance display

---

## Completed ✅

- [x] Multi-agent coordination system
- [x] Token economics foundation (mock blockchain)
- [x] Prediction market (inter-agent, MD review, user modal)
- [x] Recovery metrics tracking
- [x] Fast mode consultations
- [x] MD review auto-flagging (3+ specialists, 70% confidence)
- [x] MindMender keyword detection (Option 1)
- [x] Feedback modal integration
- [x] Milestone follow-up structure
- [x] **Orthopedic scope validation** (v0.4.0) - Pre-agent filtering with 69 tests

---

## Ideas / Future Considerations

- Voice-based consultation input
- Image analysis for injury assessment
- Integration with wearable devices for recovery tracking
- Multi-language support
- FHIR integration for medical record systems
- Telemedicine video consultation integration
- Mobile app for patient tracking
- Provider dashboard for MD review workflow

---

## Notes

- Server restarts currently reset token balances (in-memory)
- Prediction staking requires persistent blockchain wallets
- MindMender routing needs monitoring after Option 1 deployment
- Consider A/B testing for specialist routing algorithms
- **Scope Validation**: Monitor redirect logs to tune keyword dictionaries; toggle with `ENABLE_SCOPE_VALIDATION=false` if needed
