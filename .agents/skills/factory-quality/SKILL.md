---
name: factory-quality
description: Verify Studio milestone acceptance, toolchain changes, regression coverage, and platform evidence before review.
---

# Studio quality

1. Read the assigned phase in [Roadmap](../../../docs/ROADMAP.md) and select checks from [Testing strategy](../../../docs/TESTING_STRATEGY.md).
2. Translate each gate to observable commands and normal user flows. Use temporary directories, Git repositories, profiles, and databases when relevant.
3. Verify applicable typecheck, lint, build and tests. Review boundary changes against [Security](../../../docs/SECURITY.md) and inspect recovery and failure paths.
4. Review the complete diff against the agreed base, including new files. Check scope and remove unintended artifacts or credential material from the proposed change set.
5. Record commands and results in [Progress](../../../docs/PROGRESS.md). Attribute each result to its actual platform and test layer. Identify blocked checks and their required runtime.
6. Update the specifications when the reviewed implementation changes a contract or accepted decision.
