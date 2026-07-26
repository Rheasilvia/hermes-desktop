export default async function beforeBuild() {
  // The build stages the complete node-pty runtime under dist/node_modules.
  // Skip electron-builder's workspace dependency collector so it cannot add a
  // second, host-ambiguous native dependency tree.
  return false
}
