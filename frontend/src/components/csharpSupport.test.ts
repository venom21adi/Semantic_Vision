import { describe, expect, it } from 'vitest'
import { highlightSource } from './highlightSource'
import { languageLabel } from './RepoLoader'

describe('C# support', () => {
  it('labels the csharp language as C#', () => {
    expect(languageLabel('csharp')).toBe('C#')
  })

  it('syntax-highlights .cs source as C#', () => {
    const result = highlightSource('public class Foo { }', 'src/Foo.cs')
    expect(result?.language).toBe('csharp')
    expect(result?.html).toContain('hljs-keyword')
  })

  it('still leaves unknown extensions unhighlighted', () => {
    expect(highlightSource('x', 'notes.txt')).toBeNull()
  })
})
