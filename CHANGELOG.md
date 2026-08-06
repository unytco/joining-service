# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release workflow: pushing a semver tag bundles the Cloudflare Worker and attaches it to a GitHub release
- `bundle:worker` script producing a single deployable Worker script in `build/`

### Fixed

- Enable `nodejs_compat` in the Worker config so `node:crypto` imports do not throw at runtime
