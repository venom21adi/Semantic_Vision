# jellyfin/jellyfin (C#)

[Jellyfin](https://github.com/jellyfin/jellyfin), the free software media server — one of the
largest actively maintained C# applications on GitHub — chosen as the C# benchmark the same way
FastAPI, nest, Guava and Hugo were chosen for their languages: a real, unmodified production
codebase, not a synthetic benchmark repo. It is also a *typical* C# application (ASP.NET Core,
dependency injection, async everywhere, nullable reference types, a few dozen projects), which is
the shape most C# users will point this tool at.

Benchmarked at commit `df62c85155061aea7b65d7bcfb84e460550f62e2` (2026-11-18), **full repo, no
scoping**: 2,252 `.cs` files across 43 projects, about 365,000 lines.

## Results

| Metric | Value |
|---|---|
| Files | 2,252 |
| Nodes | 15,673 (10,616 functions, 2,355 classes, 2,252 files, 450 directories) |
| Edges | 73,022 |
| Parse errors | **0** |
| Backend parse | 15.1–15.6s † |
| Complexity index build | 8.0–8.2s |
| `POST /api/parse-repo` | 17.64s |
| `GET /api/graph` | 0.20s |
| Graph payload | 20,513 KB |
| Browser: time to data | 16.66–17.80s |
| Browser: time to render | 19.66–20.54s |

The browser numbers are the range across four consecutive runs, each from a clean state (the
`.visualiser` directory removed between runs). The backend numbers are three consecutive runs.

† No cold/warm pair is published for this repo. The clone was read many times on this machine
before the final runs, so a "cold" figure would not be cold; and the one genuinely first-touch
read it did get (Windows Defender scanning each freshly written file) spent 68 of its 99 seconds
inside `open()`, which measures the antivirus rather than Semantic Vision. Reading files on a
thread pool (see below) removed that wait from the pipeline.

## Notes

**Zero parse errors across a real C# codebase**, including nullable annotations, records,
file-scoped namespaces, primary constructors and collection expressions. C# is parsed with
`tree-sitter-c-sharp`, and two grammar gaps had to be worked around to get here, both found by
measuring other large repositories rather than this one: conditional compilation (`#if`) is
resolved before parsing, and `async` used as an identifier (`bool async`) is neutralised —
without that second one a single file of EF Core's tests lost all of its methods silently.

**Accuracy on this repo, against the real C# compiler: 98.0% recall, 98.2% precision** over
19,725 calls the compiler sends to repository code. Jellyfin was *held out* — it was not used
while building the resolver. Method and reproduction: [guides/csharp.md](../guides/csharp.md).

**This is the slowest load in the set, and it is the backend, not the browser.** Time to data
(~17s) is almost all parse + resolve (15s); the step from data to the first node painted is
about 3s, close to Hugo's. C# resolution does more work per call site than the other languages
(it types receivers, picks overloads, applies project references), and Jellyfin has more files
than any other repository in this set (2,252, against at most 1,907). The scale ceiling
was checked separately on EF Core (5,872 files, 1.8 million lines, 108,265 nodes, 457,886 edges):
parse 90s, Code Health index 53s, 1.3 GB peak, zero parse errors. That run was a backend scale
test; its graph was not loaded in the browser.

**The Code Health index (8s) is about half of parse time.** Profiling showed the cost is
re-parsing every file (about 4s of it) plus counting decision points; counting was moved from a
Python walk over every syntax node to a native tree-sitter query, which cut the index from 12.5s to
8s here (80s to 53s on EF Core). What remains is the re-parse, which holds Python's GIL, so it does
not parallelise with threads.

**Reading files on a thread pool** is a pipeline change made while benchmarking this repo (it
applies to every language): on a machine with antivirus, the first read of each file dominated a
large load. Parsing stays sequential and sorted, and the output is byte-identical.

**A harness fix came out of this run.** On a repo this size the Codebase tree keeps re-rendering
for a few seconds after the data arrives, which silently dropped the harness's single batch of
"Show on canvas" clicks, so the canvas stayed empty and the load looked hung. The benchmark now
retries the selection until a node renders (only unchecked boxes are clicked, so a retry never
un-selects). It was a harness race, not an application bug — selecting after a short wait
rendered the graph immediately.
