#!/usr/bin/env node

/**
 * Test script to validate AequOs-Agents optimizations
 */

import fetch from 'node-fetch';

const API_URL = 'http://localhost:3000';

// Test case data
const testCase = {
  caseData: {
    age: 45,
    gender: 'male',
    primaryComplaint: 'knee pain when running',
    symptoms: ['knee pain', 'swelling after exercise', 'stiffness in morning'],
    painLevel: 6,
    location: 'left knee', 
    duration: '2 weeks',
    urgency: 'routine',
    complexity: 5
  },
  requiredSpecialists: ['triage', 'painWhisperer', 'movementDetective']
};

async function runTests() {
  console.log('🧪 Testing AequOs-Agents Optimizations\n');
  
  // 1. Test Health
  console.log('1️⃣ Testing Health Endpoint...');
  const healthResponse = await fetch(`${API_URL}/health`);
  const health = await healthResponse.json();
  console.log(`   ✅ System: ${health.status}`);
  console.log(`   ✅ Agents: ${health.agents}`);
  console.log('');
  
  // 2. Test Status
  console.log('2️⃣ Testing Status Endpoint...');
  const statusResponse = await fetch(`${API_URL}/status`);
  const status = await statusResponse.json();
  console.log(`   ✅ Version: ${status.system.version}`);
  console.log(`   ✅ Optimizations: ${status.system.optimizationsEnabled}`);
  console.log(`   ✅ Cache Size: ${status.performance.cache.size}/${status.performance.cache.maxSize}`);
  console.log('');
  
  // 3. Test Fast Mode Consultation
  console.log('3️⃣ Testing Fast Mode Consultation...');
  const startTime = Date.now();
  
  try {
    const consultResponse = await fetch(`${API_URL}/consultation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...testCase,
        mode: 'fast'
      })
    });
    
    const consultation = await consultResponse.json();
    const responseTime = Date.now() - startTime;
    
    if (consultation.error) {
      console.log(`   ❌ Error: ${consultation.error}`);
      console.log(`   Message: ${consultation.message}`);
    } else {
      console.log(`   ✅ Response Time: ${responseTime}ms ${responseTime < 5000 ? '🚀' : '🐢'}`);
      console.log(`   ✅ From Cache: ${consultation.fromCache || false}`);
      console.log(`   ✅ Mode: ${consultation.mode || 'unknown'}`);
      
      if (consultation.consultation) {
        console.log(`   ✅ Specialists: ${consultation.consultation.participatingSpecialists?.length || 0}`);
        console.log(`   ✅ Duration: ${consultation.consultation.duration || 'N/A'}ms`);
      }
    }
  } catch (error) {
    console.log(`   ❌ Request failed: ${error.message}`);
  }
  console.log('');
  
  // 4. Test Cache Hit
  console.log('4️⃣ Testing Cache Hit (second request)...');
  const cacheStartTime = Date.now();
  
  try {
    const cacheResponse = await fetch(`${API_URL}/consultation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...testCase,
        mode: 'fast'
      })
    });
    
    const cachedConsult = await cacheResponse.json();
    const cacheResponseTime = Date.now() - cacheStartTime;
    
    console.log(`   ✅ Response Time: ${cacheResponseTime}ms ${cacheResponseTime < 100 ? '⚡' : '🚀'}`);
    console.log(`   ✅ From Cache: ${cachedConsult.fromCache || false}`);
    
  } catch (error) {
    console.log(`   ❌ Cache test failed: ${error.message}`);
  }
  console.log('');
  
  // 5. Check Final Stats
  console.log('5️⃣ Final Performance Stats...');
  const finalStatus = await fetch(`${API_URL}/status`);
  const finalStats = await finalStatus.json();
  
  console.log(`   📊 Cache Stats:`);
  console.log(`      • Hit Rate: ${finalStats.performance.cache.hitRate}`);
  console.log(`      • Hits: ${finalStats.performance.cache.hits}`);
  console.log(`      • Misses: ${finalStats.performance.cache.misses}`);
  console.log(`      • Size: ${finalStats.performance.cache.size}`);
  
  console.log(`   📊 Prompt Stats:`);
  console.log(`      • Fast Mode: ${finalStats.performance.prompts.fastModeUsage}`);
  console.log(`      • Learning Mode: ${finalStats.performance.prompts.learningModeUsage}`);
  
  console.log('\n✨ Testing Complete!\n');
}

// Run tests
runTests().catch(console.error);