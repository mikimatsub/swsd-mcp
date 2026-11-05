import { describe, expect, it } from 'vitest';
import { checkChangelog } from '../../scripts/check-changelog.mjs';

const repository = 'https://github.com/mikimatsub/swsd-mcp';
const fixture = `# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Synthetic upcoming feature.

## [1.1.0] - 2026-02-28

### Changed

- Synthetic behavior change.

### Fixed

- Synthetic bug fix.

## [1.0.0] - 2026-01-01

### Added

- Synthetic initial feature.

[unreleased]: ${repository}/compare/v1.1.0...HEAD
[1.1.0]: ${repository}/compare/v1.0.0...v1.1.0
[1.0.0]: ${repository}/releases/tag/v1.0.0
`;

describe('changelog format', () => {
  it('accepts a complete changelog and CRLF newlines', () => {
    expect(checkChangelog(fixture)).toEqual([]);
    expect(checkChangelog(fixture.replaceAll('\n', '\r\n'))).toEqual([]);
  });

  it('accepts yanked releases and an empty Unreleased section', () => {
    expect(checkChangelog(fixture
      .replace('2026-02-28', '2026-02-28 [YANKED]')
      .replace('### Added\n\n- Synthetic upcoming feature.\n\n', ''))).toEqual([]);
  });

  it.each([
    ['missing title', '# Changelog', '# Release notes', 'Start with # Changelog'],
    ['missing adherence', 'https://keepachangelog.com/en/1.1.0/', 'https://example.com/', 'Declare Keep a Changelog'],
    ['missing SemVer', 'https://semver.org/spec/v2.0.0.html', 'https://example.com/', 'Declare Keep a Changelog'],
    ['missing Unreleased', '## [Unreleased]', '## [2.0.0] - 2026-03-01', 'Put ## [Unreleased] first'],
    ['duplicate Unreleased', '## [1.1.0] - 2026-02-28', '## [Unreleased]', 'Duplicate release heading'],
    ['undated release', '## [1.1.0] - 2026-02-28', '## [1.1.0]', 'Use ## [X.Y.Z]'],
    ['non-SemVer release', '[1.1.0] -', '[01.1.0] -', 'Use ## [X.Y.Z]'],
    ['bad date format', '2026-02-28', '2026-2-28', 'Use ## [X.Y.Z]'],
    ['invalid day', '2026-02-28', '2026-02-30', 'Use a real calendar date'],
    ['invalid month', '2026-02-28', '2026-13-01', 'Use a real calendar date'],
    ['ascending dates', '2026-02-28', '2025-12-31', 'Release dates must be reverse chronological'],
    ['ascending versions', '## [1.0.0]', '## [1.2.0]', 'Release versions must be strictly descending'],
    ['duplicate version', '## [1.0.0]', '## [1.1.0]', 'Duplicate release heading'],
    ['custom category', '### Changed', '### Internal', 'Use only these categories'],
    ['decorated category', '### Added', '### Added (feature)', 'Use only these categories'],
    ['duplicate category', '### Fixed', '### Changed', 'Categories must be unique'],
    ['category order', '### Changed', '### Security', 'Categories must be unique and in the required order'],
    ['empty category', '- Synthetic bug fix.', '', 'Empty Fixed category'],
    ['uncategorized content', '### Changed\n\n', '', 'Put release content under a change category'],
    ['nested heading', '### Changed', '#### Changed', 'Use only the title'],
    ['missing link', `[1.0.0]: ${repository}/releases/tag/v1.0.0`, '', 'Missing or incorrect bottom link for [1.0.0]'],
    ['stale Unreleased link', 'v1.1.0...HEAD', 'v1.0.0...HEAD', 'Missing or incorrect bottom link for [Unreleased]'],
    ['reversed compare', 'v1.0.0...v1.1.0', 'v1.1.0...v1.0.0', 'Missing or incorrect bottom link for [1.1.0]'],
    ['content after references', '[1.1.0]:', 'Unexpected text\n[1.1.0]:', 'Only link references'],
  ])('rejects %s', (_name, before, after, expected) => {
    expect(checkChangelog(fixture.replace(before, after)).join('\n')).toContain(expected);
  });

  it('rejects misplaced, duplicate, and orphaned references', () => {
    expect(checkChangelog(`${fixture}\nUnexpected text`).join('\n')).toContain('Only link references');
    expect(checkChangelog(`${fixture}\n[UNRELEASED]: ${repository}/compare/v1.1.0...HEAD`).join('\n')).toContain('Duplicate link reference');
    expect(checkChangelog(`${fixture}\n[0.9.0]: ${repository}/releases/tag/v0.9.0`).join('\n')).toContain('has no release heading');
  });

  it('compares version components numerically and permits releases on the same date', () => {
    expect(checkChangelog(fixture.replaceAll('[1.1.0]', '[1.10.0]').replaceAll('v1.1.0', 'v1.10.0')
      .replaceAll('[1.0.0]', '[1.9.0]').replaceAll('v1.0.0', 'v1.9.0')
      .replace('2026-01-01', '2026-02-28'))).toEqual([]);
  });
});
