/**
 * Scope Validator Utility
 *
 * Validates whether user queries fall within orthopedic/sports medicine scope.
 * Filters non-orthopedic queries BEFORE agent processing to save API costs
 * and prevent inappropriate responses.
 *
 * Priority order: In-scope affirmer > Out-of-scope > Default pass (err on inclusion)
 */

import logger from './logger.js';

/**
 * Check if scope validation is enabled (evaluated at runtime)
 * @returns {boolean}
 */
function isScopeValidationEnabled() {
  return process.env.ENABLE_SCOPE_VALIDATION !== 'false';
}

/**
 * Out-of-scope condition patterns with exclusion rules
 * Each category has terms that trigger rejection, plus exclusions that override
 */
const OUT_OF_SCOPE_PATTERNS = {
  cardiac: {
    terms: ['heart disease', 'arrhythmia', 'heart palpitations', 'high blood pressure', 'cardiac'],
    excludeIfPresent: ['chest wall', 'rib', 'costochondritis']
  },
  endocrine: {
    terms: ['diabetes', 'blood sugar', 'thyroid', 'insulin', 'hormone therapy'],
    excludeIfPresent: []
  },
  dermatology: {
    terms: ['skin rash', 'acne', 'eczema', 'psoriasis', 'dermatitis'],
    excludeIfPresent: []
  },
  gastrointestinal: {
    terms: ['stomach pain', 'diarrhea', 'acid reflux', 'bowel', 'nausea', 'vomiting'],
    excludeIfPresent: ['abdominal muscle', 'core injury', 'oblique strain']
  },
  respiratory: {
    terms: ['asthma', 'copd', 'lung disease', 'bronchitis', 'wheezing', 'shortness of breath', 'breathing difficulty', 'difficulty breathing'],
    excludeIfPresent: ['chest wall', 'rib pain', 'hurts to breathe']
  },
  mental_health_standalone: {
    terms: ['depression diagnosis', 'bipolar disorder', 'schizophrenia', 'panic disorder'],
    excludeIfPresent: ['injury', 'pain', 'surgery', 'recovery', 'fear of movement', 'return to play', 'return to sport', 'performance anxiety', 'surgery anxiety', 'rehabilitation']
  },
  oncology: {
    terms: ['cancer treatment', 'tumor', 'chemotherapy', 'radiation therapy'],
    excludeIfPresent: ['bone cancer', 'osteosarcoma']
  },
  infectious: {
    terms: ['flu symptoms', 'cold', 'covid symptoms', 'fever', 'infection'],
    excludeIfPresent: ['joint infection', 'septic arthritis', 'osteomyelitis']
  },
  pregnancy: {
    terms: ['pregnant', 'prenatal', 'pregnancy'],
    excludeIfPresent: ['back pain', 'pelvic pain', 'pelvic girdle pain', 'sciatica']
  },
  dental: {
    terms: ['toothache', 'cavity', 'dental work', 'root canal'],
    excludeIfPresent: ['tmj', 'jaw joint', 'temporomandibular']
  },
  neurological: {
    terms: ['seizure', 'epilepsy', 'migraine', 'headache'],
    excludeIfPresent: ['cervicogenic', 'neck pain', 'whiplash']
  }
};

/**
 * In-scope affirmer patterns - override protection against false positives
 * If any of these are detected, the query passes regardless of out-of-scope terms
 */
const IN_SCOPE_AFFIRMERS = {
  musculoskeletal: [
    'joint pain', 'muscle pain', 'bone pain', 'tendon', 'ligament',
    'sprain', 'strain', 'subluxation', 'dislocation', 'fracture',
    'arthritis', 'bursitis'
  ],
  body_parts: [
    'shoulder', 'elbow', 'wrist', 'hand', 'finger', 'fingers', 'thumb',
    'hip', 'knee', 'ankle', 'foot', 'feet', 'toe', 'toes',
    'spine', 'back', 'neck', 'clavicle', 'pelvis'
  ],
  sports_injury: [
    'sports injury', 'rotator cuff', 'acl', 'mcl', 'pcl', 'meniscus',
    'tennis elbow', 'golfer\'s elbow', 'runner\'s knee'
  ],
  special_cases: [
    'cervicogenic headache', 'tmj', 'temporomandibular joint',
    'chest wall pain', 'costochondritis', 'rib pain'
  ],
  recovery: [
    'post surgery', 'post surgical', 'rehabilitation', 'physical therapy',
    'return to sport', 'return to play', 'return to activity'
  ]
};

/**
 * Redirect message templates for out-of-scope conditions
 */
const REDIRECT_MESSAGES = {
  cardiac: {
    title: "Heart-Related Concerns",
    message: "I specialize in musculoskeletal conditions. For heart or cardiovascular concerns, please consult your primary care provider or a cardiologist.",
    suggestion: "Schedule an appointment with your primary care physician or cardiologist."
  },
  endocrine: {
    title: "Metabolic/Endocrine Concerns",
    message: "I specialize in orthopedic and sports medicine. For questions about diabetes, thyroid, or other metabolic conditions, please consult an endocrinologist or your primary care provider.",
    suggestion: "Contact your primary care provider or an endocrinology specialist."
  },
  mental_health_standalone: {
    title: "Mental Health Support",
    message: "I specialize in orthopedic care. For mental health concerns not related to injury recovery, please consult a mental health professional.",
    suggestion: "Consider reaching out to a therapist, counselor, or psychiatrist."
  },
  dermatology: {
    title: "Skin Condition Detected",
    message: "I specialize in musculoskeletal conditions. For skin-related concerns, a dermatologist would be more appropriate.",
    suggestion: "Consider consulting a dermatologist for this concern."
  },
  gastrointestinal: {
    title: "Digestive Health Concerns",
    message: "I specialize in orthopedic and sports medicine. For digestive or gastrointestinal concerns, please consult your primary care provider or a gastroenterologist.",
    suggestion: "Contact your primary care provider for digestive health concerns."
  },
  respiratory: {
    title: "Respiratory Concerns",
    message: "I specialize in musculoskeletal conditions. For respiratory or lung-related concerns, please consult your primary care provider or a pulmonologist.",
    suggestion: "Schedule an appointment with your primary care physician."
  },
  oncology: {
    title: "Cancer-Related Concerns",
    message: "I specialize in orthopedic care. For cancer-related concerns, please consult your oncologist or primary care provider.",
    suggestion: "Contact your oncologist or primary care provider."
  },
  infectious: {
    title: "Infection or Illness Concerns",
    message: "I specialize in orthopedic and sports medicine. For infections, fevers, or illness symptoms, please consult your primary care provider.",
    suggestion: "Contact your primary care provider for these symptoms."
  },
  pregnancy: {
    title: "Pregnancy-Related Concerns",
    message: "I specialize in orthopedic care. For pregnancy-related concerns, please consult your OB/GYN or midwife.",
    suggestion: "Contact your OB/GYN or midwife for pregnancy-related questions."
  },
  dental: {
    title: "Dental Concerns",
    message: "I specialize in musculoskeletal conditions. For dental concerns, please consult your dentist.",
    suggestion: "Schedule an appointment with your dentist."
  },
  neurological: {
    title: "Neurological Concerns",
    message: "I specialize in orthopedic care. For neurological concerns like seizures or migraines, please consult a neurologist.",
    suggestion: "Contact your primary care provider for a neurology referral."
  },
  default: {
    title: "Specialized Care Recommended",
    message: "I specialize in orthopedic and sports medicine conditions. Your question appears to fall outside this specialty. Please consult with an appropriate healthcare provider.",
    suggestion: "Contact your primary care provider for a referral to the appropriate specialist."
  }
};

/**
 * Build combined text from query and case data for analysis
 * @param {string} query - Raw user query
 * @param {Object} caseData - Structured case data
 * @returns {string} Combined lowercase text for matching
 */
function buildCombinedText(query, caseData) {
  const parts = [query || ''];
  if (caseData.symptoms) parts.push(caseData.symptoms);
  if (caseData.primaryComplaint) parts.push(caseData.primaryComplaint);
  if (caseData.rawQuery) parts.push(caseData.rawQuery);
  return parts.join(' ').toLowerCase();
}

/**
 * Check for in-scope affirmer keywords
 * @param {string} text - Lowercase combined text
 * @returns {Object} { isInScope, type, confidence, matchedTerms }
 */
function checkInScopeAffirmers(text) {
  for (const [type, terms] of Object.entries(IN_SCOPE_AFFIRMERS)) {
    for (const term of terms) {
      if (text.includes(term)) {
        return {
          isInScope: true,
          type,
          confidence: 0.85,
          matchedTerms: [term]
        };
      }
    }
  }
  return { isInScope: false };
}

/**
 * Check for out-of-scope conditions with exclusion logic
 * @param {string} text - Lowercase combined text
 * @returns {Object} { isOutOfScope, type, confidence, matchedTerms }
 */
function checkOutOfScope(text) {
  for (const [type, pattern] of Object.entries(OUT_OF_SCOPE_PATTERNS)) {
    // Check for exclusions first (orthopedic context overrides)
    const hasExclusion = pattern.excludeIfPresent.some(term => text.includes(term));
    if (hasExclusion) continue;

    // Check for out-of-scope terms
    for (const term of pattern.terms) {
      if (text.includes(term)) {
        return {
          isOutOfScope: true,
          type,
          confidence: 0.8,
          matchedTerms: [term]
        };
      }
    }
  }
  return { isOutOfScope: false };
}

/**
 * Build result for queries that should pass to agent
 * @param {Object} checkResult - Result from affirmer check
 * @returns {Object} Validation result
 */
function passResult(checkResult) {
  return {
    category: 'in_scope',
    passToAgent: true,
    redirectMessage: null,
    detectedCategory: checkResult.type || null,
    confidence: checkResult.confidence || 0.5,
    matchedTerms: checkResult.matchedTerms || []
  };
}

/**
 * Build result for out-of-scope queries
 * @param {Object} checkResult - Result from out-of-scope check
 * @returns {Object} Validation result with redirect message
 */
function rejectResult(checkResult) {
  const message = REDIRECT_MESSAGES[checkResult.type] || REDIRECT_MESSAGES.default;
  return {
    category: 'out_of_scope',
    passToAgent: false,
    redirectMessage: message,
    detectedCategory: checkResult.type,
    confidence: checkResult.confidence,
    matchedTerms: checkResult.matchedTerms
  };
}

/**
 * Log scope redirects for analysis
 * @param {string} category - 'out_of_scope'
 * @param {string} originalQuery - The user's original query
 * @param {string[]} matchedTerms - Keywords that triggered the redirect
 * @param {string} detectedType - The detected condition category
 */
function logScopeRedirect(category, originalQuery, matchedTerms, detectedType) {
  logger.info({
    event: 'scope_redirect',
    category,
    detectedType,
    matchedTerms,
    timestamp: new Date().toISOString()
  });
}

/**
 * Validate if a query is within orthopedic scope
 * Priority order: In-scope affirmer > Out-of-scope > Default pass
 *
 * @param {string} query - Raw user query text
 * @param {Object} caseData - Structured case data
 * @returns {Object} ScopeValidationResult
 */
export function validateScope(query, caseData = {}) {
  // Feature flag check - bypass validation if disabled (evaluated at runtime)
  if (!isScopeValidationEnabled()) {
    return {
      category: 'in_scope',
      passToAgent: true,
      redirectMessage: null,
      detectedCategory: null,
      confidence: 1.0,
      matchedTerms: []
    };
  }

  const text = buildCombinedText(query, caseData);

  // Priority 1: Check for in-scope affirmers (prevents false positives)
  const inScopeCheck = checkInScopeAffirmers(text);
  if (inScopeCheck.isInScope) {
    return passResult(inScopeCheck);
  }

  // Priority 2: Check for out-of-scope conditions
  const outOfScopeCheck = checkOutOfScope(text);
  if (outOfScopeCheck.isOutOfScope) {
    logScopeRedirect('out_of_scope', query, outOfScopeCheck.matchedTerms, outOfScopeCheck.type);
    return rejectResult(outOfScopeCheck);
  }

  // Priority 3: Default pass (err on inclusion)
  return passResult({ type: null, confidence: 0.5 });
}

export default validateScope;
