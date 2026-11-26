# Third-party dependencies

The package manifest pins direct dependencies, and pnpm-lock.yaml pins the resolved graph. Runtime dependencies include Express (MIT), Helmet (MIT), node-postgres (MIT), React (MIT), and React DOM (MIT). TypeScript uses Apache-2.0 and Vite uses MIT. Installed packages retain upstream license and notice files.

Run pnpm licenses list --prod after a frozen install to inspect the full runtime graph and available license texts. Review license obligations for the actual dependency graph before redistribution. The client or project owner sets the license for application and client-specific code.
