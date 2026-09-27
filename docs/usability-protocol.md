# Learner Usability Test Protocol

- **Target Audience:** Individuals who know only basic JSON syntax (e.g. business analysts, operations managers, vocational school/SMK students, product managers) without formal background in programming languages like JavaScript, Java, Go, or Python.
- **Evaluation Gate:** v1.0 Exit Requirement (PLAN.md §19, Phase 6).

## 1. Objectives

1. Prove the core thesis: **"JSON is enough for most business software."**
2. Verify that non-programmers can build, modify, understand, and debug application logic using only Kerangka documents.
3. Validate that compiler hints (`kerangka check`) enable self-repair without expert intervention.

## 2. Participant Profile

- 5 to 8 participants.
- Capable of editing text files in VS Code or an online web playground.
- Understands key-value pairs, lists, and numbers in JSON.
- Has NOT written professional backend code or SQL queries.

## 3. Test Tasks

### Task 1: Scaffolding and First Run (5 minutes)
- **Goal:** Run `npx kerangka dev todo.kerangka.json`.
- **Observation:** Does the participant successfully open `localhost:3000` and interact with the rendered UI?

### Task 2: Adding a Field with Constraints (10 minutes)
- **Goal:** Add a `notes` string field with a maximum length of 200 characters to `Customer` in `invoicing.kerangka.json`.
- **Observation:** Does the participant navigate shorthand syntax easily?

### Task 3: Adding a Business Rule and Recovering from Error (10 minutes)
- **Goal:** Add a rule ensuring `creditLimit <= 50000`. Introduce an intentional syntax error, run `kerangka check`, and use the compiler `hint` to fix it.
- **Observation:** Does the error hint clearly explain how to correct the JSON?

### Task 4: Modifying a Decision Table (10 minutes)
- **Goal:** Open `leave-request.kerangka.json` and add a new row to `approverRouting`: leaves over 10 days route to `board-of-directors`.
- **Observation:** Does the spreadsheet-like grid editor or JSON format feel intuitive?

## 4. Success Criteria

| Metric | Target |
|---|---|
| **Task Completion Rate** | ≥ 80% without intervention |
| **Time to Running App** | < 15 minutes from task start |
| **Error Recovery Rate** | ≥ 75% of validation errors resolved on the first attempt using compiler hints |
| **Post-Test Satisfaction** | Net Promoter Score (NPS) ≥ +40 on ease of use |
