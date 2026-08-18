# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release workflow: strict semver tag validation, a typecheck gate, and a sha256 checksum for the published Worker bundle, layered onto upstream's test/build-worker jobs. Re-running a release converges on an existing tag instead of failing.
