# Comparing reconstructed functions with an original

`scripts/match.mjs` compares identified function ranges in two local PE executables, byte for byte. It does not download binaries, execute them, disassemble them, identify function boundaries, obtain a compiler, or claim that our current WASM prototypes reconstruct original code. Owner-supplied originals and a candidate compiled using a legitimately obtained matching toolchain remain required.

Keep original executables, compiled candidate executables, and the matching manifest outside this repository. Set `XPC_ORIGINALS` to the directory holding your own originals. The tool resolves symlinks and rejects originals or candidates inside the repository, an original outside `XPC_ORIGINALS`, and comparison of a file with itself. Missing originals produce an owner-input error. Original bytes and candidate code never appear in the report; only addresses, sizes, hashes, and comparison results do.

1. Run `pnpm inspect:originals` with your own originals to record hashes and inspect PE/Rich/linker metadata. Metadata helps investigate a compiler; it does not prove its identity or flags.
2. Establish the original function boundaries with your own analysis tools. Reconstruct one function, then compile a complete PE candidate using a legitimately acquired matching compiler and linker. Keep that executable outside the repository.
3. Write an external JSON manifest containing the game, paths, and corresponding original/candidate RVA ranges. An RVA is relative to the image base, not a file offset or an absolute virtual address. Hexadecimal strings and numeric RVAs are accepted.
4. Run the comparison. Review its default private report before explicitly updating a public scoreboard.

Example manifest, using placeholder paths and illustrative ranges rather than asserted original addresses:

```json
{
  "game": "minesweeper",
  "originalExe": "/home/you/xpc-originals/winmine.exe",
  "candidateExe": "/home/you/matching-build/winmine-rebuilt.exe",
  "inventory": {
    "exhaustive": false,
    "source": "One manually identified function; remaining original functions are not inventoried."
  },
  "toolchain": {
    "compiler": "Record the actual legitimately obtained compiler here",
    "flags": "Record the actual compile and link flags here"
  },
  "buildCommit": null,
  "functions": [
    {
      "name": "replace_with_identified_function",
      "originalRva": "0x1000",
      "candidateRva": "0x1000",
      "size": 16,
      "candidateSize": 16
    }
  ]
}
```

```sh
XPC_ORIGINALS=/home/you/xpc-originals pnpm match \
  --manifest /home/you/matching-build/minesweeper.json
```

The default output is `notes/matching-minesweeper.json`, which is gitignored. The current public scoreboard stays unchanged. Publish a reviewed report into the local scoreboard only with an explicit output argument:

```sh
XPC_ORIGINALS=/home/you/xpc-originals pnpm match \
  --manifest /home/you/matching-build/minesweeper.json \
  --output scoreboard/minesweeper.json
pnpm verify:scoreboard
```

This updates a local file; it does not deploy or publish the site. Paths in a manifest resolve relative to the manifest directory. All function ranges, executable inputs, inventory assertions, and output destinations are checked before writing. Writes use an atomic replacement. The original file, candidate, manifest, and originals directory cannot be report destinations.

## What the report proves

For each named function, the tool maps both RVA ranges into file-backed executable sections. It rejects truncated PE headers, ambiguous mappings, ranges outside file-backed sections, non-executable sections, and overlapping function ranges that could double-count coverage. A function is `matched` only when both lengths and all bytes agree. No relocation bytes are masked, and no instruction or address normalization occurs.

Each function record includes original/candidate absolute addresses and RVAs, original/candidate sizes, SHA-256 of both byte slices, and SHA-256 of both complete executables. `similarity` is the count of equal bytes at corresponding offsets divided by the larger function size; it is an aligned byte statistic, not an instruction-aware diff. A byte-different function is `non-matching`, even if it behaves identically.

`matchedBytes` counts only complete exactly matched original function ranges. Percentages are truncated to six decimal places using integer arithmetic; they never round up. Function-byte coverage excludes resources, PE headers, padding outside the declared function ranges, and other non-function data. Whole-executable hashes identify the input files, and do not imply whole-executable byte equality.

## Unknown coverage stays unknown

A subset can contain real matches without establishing an overall match percentage. Unless the manifest explicitly sets `inventory.exhaustive: true`, the report has:

```json
{
  "status": "partial-inventory",
  "coverageComplete": false,
  "totalFunctions": null,
  "totalBytes": null,
  "matchPercent": null,
  "functionMatchPercent": null
}
```

`mappedFunctionCount` and `mappedBytes` describe only the supplied ranges. A subset of one matching function can never become “100% of the original.” An explicitly exhaustive inventory must also include `inventory.source` explaining how all original function boundaries were established. Its claimed completeness remains an owner-supplied assertion; this byte comparator cannot independently discover omitted functions. Only that exhaustive inventory supplies overall denominators.

Compiler provenance, candidate provenance, function boundaries, and inventory completeness require separate review. Matching headers or matching one function do not prove that the same compiler was used. Original differential behaviour testing remains a separate pending verification layer; this tool does not award `behaviour-verified` status.
