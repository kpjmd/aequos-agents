# Blinded Re-Rate — ANSWER KEY (study author only)

**Do NOT send this file to the rater.** It de-blinds `equipoise-blinded-rerate-packet.md`. Use it only
to score returned ratings (Cohen's κ) against the current benchmark labels.

Scoring: collapse the rater's three options to the binary the accuracy metric uses —
`genuine_equipoise` vs `settled` (either direction) — then compare to the current label. The direction
(→ A / → B) is a secondary check on rationale, not part of the sensitivity/specificity comparison.

| packet ID | slug | current label | adjudication round | original (pre-adjudication) label |
|---|---|---|---|---|
| DP-01 | periprosthetic-femur-fracture-vancouver-b1-orif-vs-revision | genuine_equipoise | 1 | settled_operative |
| DP-02 | knee-dislocation-multi-ligamentous-injury-brace-vs-reconstruction | genuine_equipoise | 1 | settled_operative |
| DP-03 | quadriceps-tendon-rupture-active | genuine_equipoise | 1 | settled_operative |
| DP-04 | high-energy-talus-fracture-displaced-cast-vs-orif | genuine_equipoise | 1 | settled_operative |
| DP-05 | acute-femoral-neck-fracture-garden-i-nonoperative-vs-screws | genuine_equipoise | 1 | settled_operative |
| DP-06 | ankle-fracture-stable-weberb-op-vs-nonop | settled_conservative | 2 | genuine_equipoise |
| DP-07 | chronic-osteomyelitis-antibiotics-alone-vs-debridement-and-antibiotics | genuine_equipoise | 1 | settled_operative |
| DP-08 | elbow-epicondylitis-lateral-surgery-vs-conservative | settled_conservative | 2 | genuine_equipoise |
| DP-09 | frozen-shoulder-physio-vs-surgical-release | settled_conservative | 2 | genuine_equipoise |
| DP-10 | cervical-radiculopathy-acdf-vs-pt | settled_conservative | 2 | genuine_equipoise |
| DP-11 | uncomplicated-morton-neuroma-orthotics-vs-neurectomy | genuine_equipoise | 1 | settled_conservative |

**Interpretation aid.** If the independent rater agrees with the *current* label, it supports the
adjudication. If the rater tends to agree with the *original* label instead (i.e., calls the round-1
cases "settled" and the round-2 cases "genuine"), that is direct evidence the adjudication moved the
labels toward the model rather than toward independent clinical consensus (finding C1).
