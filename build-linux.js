#!/usr/bin/env node
const { build } = require('electron-builder');
const fs = require('fs');
const path = require('path');

console.log('Building FortiMorph for Linux...\n');

// Build configuration
build({
  targets: Platform.LINUX.createTarget(['AppImage', 'deb'], Arch.x64),
  config: {
    appId: 'com.fortimorph.desktop',
    productName: 'FortiMorph',
    directories: {
      output: 'dist',
      buildResources: 'build'
    },
    files: [
      'main/**/*',
      'dist/**/*',
      'assets/**/*',
      'package.json'
    ],
    extraResources: [
      {
        from: 'data',
        to: 'data',
        filter: ['**/*']
      }
    ],
    linux: {
      target: ['AppImage', 'deb'],
      icon: 'build/icon.png',
      category: 'Utility',
      maintainer: 'FortiMorph Team'
    },
    npmRebuild: false,
    buildDependenciesFromSource: false
  }
})
  .then(() => {
    console.log('\n✅ Linux build completed successfully!');
    console.log('Check the dist/ folder for:');
    console.log('  - FortiMorph.AppImage');
    console.log('  - fortimorph-desktop_*.deb');
  })
  .catch((error) => {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
  });
