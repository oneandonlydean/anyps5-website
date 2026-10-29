# Shader decoder: measuring operand modifier coverage

A request from the website. The website team will check back for your plan before anything is frozen.

## Why

The website's progress page shows how much of AMD's RDNA 2 instruction set the shader recompiler handles: 99.73% of instruction forms decode, plus DPP lane swizzles, image formats and the 148 places the recompiler stops as unsupported. All of it comes from reading upstream's source: the opcode tables, the DPP rules, the translator, the format tables and the error sites.

One gap is listed on the page as "Not measured yet": whether the decoder accepts each **operand modifier** on each instruction. That covers:
- VOP3 `abs`, `neg`, `clamp`, `omod` and `op_sel`
- VOP3P modifiers
- SDWA byte and word selects, `dst_unused` and SDWA output modifiers
- integer source modifiers inside DPP

Whether a modifier is accepted is decided by code paths a source scan can't follow. So an instruction can show as "decoded" on the site while a game using it with `clamp` or an SDWA select still stops. Several of the 148 unsupported cases are exactly these, for example "VOP3 source modifiers are not implemented". Players see that as a game stopping, and the progress page can't show how close this area is.

## What we're asking for

A test in upstream that **runs the real decoder** on instructions carrying each modifier and records which ones it accepts. It should write the results to a JSON file the website can fetch. It must run as part of upstream's normal CI on main, so the numbers follow every merge.

What counts as done:
- Every modifier family listed above is measured against every instruction that can carry it, in every encoding where AMD's ISA allows it.
- "Accepted" means the decoder returns without an unsupported or not-implemented error. If it's cheap to also run the translator, a separate "translated" count would match how the site already reports instruction forms (decoded vs translated).
- The output is produced from the code at that commit, with no hand-kept numbers.
- The website can fetch the output from a stable URL or a fixed path in the repo, and knows which commit it came from.

How to build it is your call: where the test lives, whether it reuses AMD's machine-readable ISA (as the website does), and how combinations are chosen. Testing every modifier combination at once on every opcode likely explodes. One modifier at a time per instruction, plus the pairs known to interact, is probably enough. Tell us what you pick and why.

## A possible output shape

This is only to show what the website needs. Name and structure it however suits you, then freeze it as version 1, the way the run report was.

```json
{
  "format": "anyps5-decoder-modifiers",
  "version": 1,
  "commit": "<full sha>",
  "generated": "2026-11-01T00:00:00Z",
  "families": [
    {
      "encoding": "VOP3",
      "modifier": "clamp",
      "total": 412,
      "accepted": 398,
      "translated": 395,
      "rejected": [{ "opcode": "V_MAD_U64_U32", "message": "VOP3 integer clamp is not implemented" }]
    }
  ]
}
```

The website would show, for each family:
- a percentage
- the list of instructions it rejects
- a trend over time, starting from the first commit that publishes the file

Earlier days can't be measured again the way the source scan does it, and that's fine.

## Questions for you

1. Is running the decoder on synthesized instruction words practical with the current test setup, or does it need a minimal harness of its own?
2. How do you plan to choose the combinations, and roughly how many cases does that give?
3. Where would the output live: published with upstream's Pages next to `progress.json`, or a file in the repo?
4. Is this better proposed to the upstream maintainers as a general decoder test, with the website as one consumer?
