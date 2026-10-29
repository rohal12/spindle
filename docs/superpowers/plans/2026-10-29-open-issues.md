# Open issues 706–711 implementation plan

**Goal:** Resolve every currently open actionable issue in one pull request.

**Requirements:** GitHub issues #706–#711; no open blocked issues or pull requests at intake. Extend existing shared parsers and metadata dispatch; retain public API compatibility. Use regression tests before implementation and run repository-required validation.

- [x] #706: Extend completion traversal to expose full root/member identifier replacement spans and decoded/source mapping, including escaped suffixes in unfinished nested labels and attributes. Add public declarations, docs and consumer tests.
- [x] #707: Expose contextual dispatch for unfinished heads using existing tokenizer and effective metadata. Cover genuine invocations, parent-owned value clauses, independent labels/attributes, nesting and replaced controls.
- [x] #708: Generalize foreign-content rendering context to MathML, preserving literal content and case-sensitive attributes through macro/widget bodies. Cover MathML HTML integration points in Chromium.
- [x] #709: Bound repeated unfinished-tag probing using shared markup grammar; preserve existing tag recovery and CodeMirror line behavior. Add real-mode scaling coverage.
- [x] #710: Snapshot all session request arguments on acceptance. Verify nested values, mutable names arrays, transcripts and clone-error isolation.
- [x] #711: Resolve percent ambiguity without repeated full-prefix parsing. Verify modulo/transient correctness and public parse/validation scaling.
- [x] Review combined changes. Update changelog. Run typecheck, formatting, all Vitest tests, browser suite, build and duplication checks against origin/main.
- [x] Prepare the fix branch and pull request description with one Closes line per resolved issue; publish after verification.

Independent parser/highlighter/tooling domains are delegated using the parallel-agents skill. MathML and session fixes are implemented locally. All changes receive a combined review and verification before publication.

Review: a fresh reviewer checked the six issue domains and reproduced direct-attribute loss when annotation encoding changed. Keeping one annotation component across encodings fixes the DOM lifecycle; the regression covers both transitions. The MathML portal is explicitly limited to MathML.

Verification: typecheck, whole-tree Prettier, build, all 5,262 Vitest tests in 323 files, all 363 Chromium tests in 27 files, and all three duplication checks passed. Duplication also passed comparison with origin/main without added clones. Test runs used four workers and a 60-second timeout; browser runs used two workers and a 120-second timeout after the existing wide-Markdown fixtures exceeded the default timeout under machine load.
