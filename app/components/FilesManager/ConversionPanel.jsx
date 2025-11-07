import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, Download, FileText, Image, Archive, FileCode, 
  Settings, Shield, Loader, CheckCircle, XCircle,
  ArrowRight, Package, Zap, AlertTriangle, Info, X
} from 'lucide-react';

const ConversionPanel = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [outputFormat, setOutputFormat] = useState('');
  const [availableFormats, setAvailableFormats] = useState([]);
  const [isLoadingFormats, setIsLoadingFormats] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Conversion options
  const [options, setOptions] = useState({
    encrypt: false,
    compress: false,
    compressionLevel: 6, // Fast: 1-3, Balanced: 4-6, Maximum: 7-9
    packageMultiple: false
  });

  // Format categories for organized display (inspired by FreeConvert)
  const formatCategories = {
    'Documents': {
      icon: FileText,
      color: 'blue',
      formats: ['.pdf', '.docx', '.doc', '.txt', '.md', '.html', '.rtf', '.odt']
    },
    'Images': {
      icon: Image,
      color: 'purple',
      formats: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.svg', '.tiff', '.ico', '.heic']
    },
    'Archives': {
      icon: Archive,
      color: 'yellow',
      formats: ['.zip', '.7z', '.tar', '.gz', '.rar', '.fortipkg']
    },
    'Data & Config': {
      icon: FileCode,
      color: 'green',
      formats: ['.json', '.csv', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.sql']
    },
    'Spreadsheets': {
      icon: FileText,
      color: 'emerald',
      formats: ['.xlsx', '.xls', '.csv', '.ods']
    },
    'Presentations': {
      icon: FileText,
      color: 'orange',
      formats: ['.pptx', '.ppt', '.odp']
    },
    'Code & Scripts': {
      icon: FileCode,
      color: 'cyan',
      formats: ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.cs', '.php', '.rb', '.go', '.html', '.css', '.sh', '.bat', '.ps1']
    },
    'Audio': {
      icon: FileCode,
      color: 'pink',
      formats: ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma']
    },
    'Video': {
      icon: FileCode,
      color: 'red',
      formats: ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm', '.wmv']
    },
    'E-Books': {
      icon: FileText,
      color: 'amber',
      formats: ['.epub', '.mobi', '.azw3', '.fb2']
    },
    'Executables': {
      icon: Package,
      color: 'slate',
      formats: ['.exe', '.msi', '.dll', '.app', '.apk', '.deb', '.rpm']
    },
    'Fonts': {
      icon: FileCode,
      color: 'violet',
      formats: ['.ttf', '.otf', '.woff', '.woff2', '.eot']
    }
  };

  // Update available formats when files are selected
  useEffect(() => {
    if (selectedFiles.length > 0) {
      updateAvailableFormats();
    } else {
      setAvailableFormats([]);
      setOutputFormat('');
    }
  }, [selectedFiles]);

  const updateAvailableFormats = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsLoadingFormats(true);
    try {
      const filePath = selectedFiles[0].path;
      const formats = await window.conversionAPI.getSupportedFormats(filePath);
      
      if (formats && formats.length > 0) {
        setAvailableFormats(formats);
        setOutputFormat(formats[0]); // Auto-select first format
      } else {
        // Fallback formats
        setAvailableFormats(['.txt', '.pdf', '.zip', '.fortipkg']);
        setOutputFormat('.txt');
      }
    } catch (error) {
      console.error('Error getting formats:', error);
      setAvailableFormats(['.txt', '.pdf', '.zip', '.fortipkg']);
      setOutputFormat('.txt');
    } finally {
      setIsLoadingFormats(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    handleFileSelection(files);
  };

  const handleFileSelection = (files) => {
    const fileData = files.map(file => ({
      name: file.name,
      path: file.path,
      size: file.size,
      type: file.type,
      extension: file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    }));
    setSelectedFiles(fileData);
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files);
    handleFileSelection(files);
  };

  const handleConvert = async () => {
    if (selectedFiles.length === 0) {
      alert('⚠️ Please select at least one file to convert.');
      return;
    }

    if (!outputFormat) {
      alert('⚠️ Please select an output format.');
      return;
    }

    setIsConverting(true);
    setConversionProgress({
      current: 0,
      total: selectedFiles.length,
      phase: 'Starting conversion...'
    });

    try {
      // Select output directory
      const outputDir = await window.conversionAPI.selectOutputDirectory();
      if (!outputDir) {
        throw new Error('Output directory not selected');
      }

      // Convert each file
      const results = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setConversionProgress({
          current: i + 1,
          total: selectedFiles.length,
          phase: `Converting ${file.name}...`
        });

        const outputName = getOutputFileName(file.name, outputFormat);
        const outputPath = `${outputDir}\\${outputName}`;

        const result = await window.conversionAPI.execute({
          inputPath: file.path,
          outputPath,
          outputFormat,
          encrypt: options.encrypt,
          compress: options.compress,
          compressionLevel: options.compressionLevel
        });

        results.push({ file: file.name, result });
      }

      // Show success message
      alert(`✅ Conversion Complete!\n\nSuccessfully converted ${results.length} file(s).\n\nLocation: ${outputDir}`);
      
      // Clear selected files
      setSelectedFiles([]);
      setOutputFormat('');
      
    } catch (error) {
      console.error('Conversion failed:', error);
      alert(`❌ Conversion Failed\n\n${error.message}`);
    } finally {
      setIsConverting(false);
      setConversionProgress(null);
    }
  };

  const getOutputFileName = (inputName, format) => {
    const nameWithoutExt = inputName.substring(0, inputName.lastIndexOf('.')) || inputName;
    return `${nameWithoutExt}${format}`;
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getCompressionLabel = () => {
    if (options.compressionLevel <= 3) return 'Fast';
    if (options.compressionLevel <= 6) return 'Balanced';
    return 'Maximum';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap className="w-7 h-7 text-cyan-400" />
            File Conversion
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Convert files between formats with encryption and compression
          </p>
        </div>
      </div>

      {/* Drag & Drop Area */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-12 transition-all duration-200 cursor-pointer
          ${dragActive 
            ? 'border-cyan-400 bg-cyan-400/10 scale-[1.02]' 
            : 'border-gray-600 hover:border-cyan-500 bg-gradient-to-br from-slate-800/50 to-slate-900/50'
          }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
        
        <div className="flex flex-col items-center justify-center text-center">
          <Upload className={`w-16 h-16 mb-4 transition-colors ${dragActive ? 'text-cyan-400' : 'text-gray-500'}`} />
          <p className="text-lg font-semibold text-white mb-2">
            {dragActive ? 'Drop files here' : 'Drop files or click to browse'}
          </p>
          <p className="text-sm text-gray-400">
            Supports all major file formats • Multiple files allowed
          </p>
        </div>
      </div>

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-gray-700/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" />
              Selected Files ({selectedFiles.length})
            </h3>
            <button
              onClick={() => setSelectedFiles([])}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Clear All
            </button>
          </div>
          
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-black/30 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-all"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <FileText className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{file.name}</p>
                    <p className="text-gray-400 text-xs">{formatBytes(file.size)} • {file.extension}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="ml-3 p-1 hover:bg-red-500/20 rounded transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format Selection - FreeConvert Style */}
      {selectedFiles.length > 0 && (
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-cyan-400" />
            Convert To
          </h3>

          {isLoadingFormats ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-6 h-6 text-cyan-400 animate-spin" />
              <span className="ml-3 text-gray-400">Loading formats...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(formatCategories).map(([category, { icon: Icon, color, formats }]) => {
                const availableInCategory = formats.filter(f => availableFormats.includes(f));
                
                if (availableInCategory.length === 0) return null;

                const colorClasses = {
                  blue: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                  purple: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
                  yellow: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
                  green: 'bg-green-500/20 text-green-300 border-green-500/30',
                  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
                  orange: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
                  cyan: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
                  pink: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
                  red: 'bg-red-500/20 text-red-300 border-red-500/30',
                  amber: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                  slate: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
                  violet: 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                };

                return (
                  <div key={category}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`w-4 h-4 text-${color}-400`} />
                      <span className="text-sm font-medium text-gray-300">{category}</span>
                      <span className="text-xs text-gray-500">({availableInCategory.length})</span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                      {availableInCategory.map((format) => (
                        <button
                          key={format}
                          onClick={() => setOutputFormat(format)}
                          className={`px-2 py-2 rounded-lg border-2 transition-all duration-150 text-xs font-medium truncate
                            ${outputFormat === format
                              ? colorClasses[color] + ' shadow-lg scale-105'
                              : 'bg-black/30 text-gray-400 border-gray-700 hover:border-gray-600 hover:bg-black/50'
                            }`}
                          title={format}
                        >
                          {format.replace('.', '').toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Conversion Options */}
      {selectedFiles.length > 0 && outputFormat && (
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyan-400" />
            Conversion Options
          </h3>

          <div className="space-y-4">
            {/* Encryption Toggle */}
            <div className="flex items-center justify-between p-4 bg-black/30 rounded-lg border border-white/5">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-purple-400" />
                <div>
                  <p className="text-white font-medium">Encrypt Output</p>
                  <p className="text-xs text-gray-400">AES-256 encryption for security</p>
                </div>
              </div>
              <button
                onClick={() => setOptions(prev => ({ ...prev, encrypt: !prev.encrypt }))}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  options.encrypt ? 'bg-purple-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    options.encrypt ? 'translate-x-7' : ''
                  }`}
                />
              </button>
            </div>

            {/* Compression Toggle */}
            <div className="flex items-center justify-between p-4 bg-black/30 rounded-lg border border-white/5">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-white font-medium">Compress Output</p>
                  <p className="text-xs text-gray-400">Reduce file size</p>
                </div>
              </div>
              <button
                onClick={() => setOptions(prev => ({ ...prev, compress: !prev.compress }))}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  options.compress ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    options.compress ? 'translate-x-7' : ''
                  }`}
                />
              </button>
            </div>

            {/* Compression Level Slider */}
            {options.compress && (
              <div className="p-4 bg-black/30 rounded-lg border border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-white font-medium">Compression Level</label>
                  <span className="text-cyan-400 text-sm font-medium">{getCompressionLabel()}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="9"
                  value={options.compressionLevel}
                  onChange={(e) => setOptions(prev => ({ ...prev, compressionLevel: parseInt(e.target.value) }))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>Fast (1)</span>
                  <span>Balanced (6)</span>
                  <span>Maximum (9)</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Convert Button */}
      {selectedFiles.length > 0 && outputFormat && (
        <button
          onClick={handleConvert}
          disabled={isConverting}
          className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 
            disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed
            text-white font-semibold py-4 px-6 rounded-xl shadow-lg transition-all duration-200
            flex items-center justify-center gap-3 transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {isConverting ? (
            <>
              <Loader className="w-5 h-5 animate-spin" />
              <span>Converting... {conversionProgress?.current}/{conversionProgress?.total}</span>
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              <span>Convert {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''} to {outputFormat.toUpperCase().replace('.', '')}</span>
            </>
          )}
        </button>
      )}

      {/* Progress Indicator */}
      {isConverting && conversionProgress && (
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-cyan-500/30">
          <div className="flex items-center gap-3 mb-3">
            <Loader className="w-5 h-5 text-cyan-400 animate-spin" />
            <span className="text-white font-medium">{conversionProgress.phase}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-300 rounded-full"
              style={{ width: `${(conversionProgress.current / conversionProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-sm text-gray-400 mt-2">
            {conversionProgress.current} of {conversionProgress.total} complete
          </p>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-100">
            <p className="font-medium mb-1">Supported Formats</p>
            <p className="text-blue-200/80">
              Documents, images, archives, code files, and more. FortiMorph supports universal file conversion 
              with automatic format detection and intelligent conversion routing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversionPanel;
