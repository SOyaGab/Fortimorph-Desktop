import React, { memo } from 'react';

/**
 * ProcessRow - Optimized individual process row component
 * 
 * Uses React.memo() with custom comparison to prevent unnecessary re-renders
 * Only updates when the process data actually changes
 */
const ProcessRow = memo(({ 
  process, 
  index, 
  onKillProcess,
  showKillButton = true 
}) => {
  const getCpuColor = (cpu) => {
    if (cpu > 50) return 'text-red-400';
    if (cpu > 25) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getMemoryColor = (memPercent) => {
    if (memPercent > 5) return 'text-red-400';
    if (memPercent > 2) return 'text-yellow-400';
    return 'text-blue-400';
  };

  const formatMemory = (bytes) => {
    if (!bytes) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(2)} MB`;
  };

  const formatCpu = (cpu) => {
    if (cpu === undefined || cpu === null) return '0.00';
    return cpu.toFixed(2);
  };

  const formatMemoryPercent = (percent) => {
    if (percent === undefined || percent === null) return '0.00';
    return percent.toFixed(2);
  };

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3 text-slate-300 text-sm">
        {index + 1}
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm font-medium">
        {process.name || 'Unknown'}
      </td>
      <td className="px-4 py-3 text-slate-400 text-sm">
        {process.pid || 'N/A'}
      </td>
      <td className={`px-4 py-3 text-sm font-semibold ${getCpuColor(process.cpu || 0)}`}>
        {formatCpu(process.cpu)}%
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">
        {formatMemory(process.memory)}
      </td>
      <td className={`px-4 py-3 text-sm font-semibold ${getMemoryColor(process.memoryPercent || 0)}`}>
        {formatMemoryPercent(process.memoryPercent)}%
      </td>
      <td className="px-4 py-3 text-slate-400 text-sm">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-900/30 text-green-400">
          {process.status || 'Running'}
        </span>
      </td>
      {showKillButton && (
        <td className="px-4 py-3 text-center">
          <button
            onClick={() => onKillProcess(process.pid, process.name)}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
            title={`Kill ${process.name}`}
          >
            Kill
          </button>
        </td>
      )}
    </tr>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function - only re-render if data actually changed
  const prev = prevProps.process;
  const next = nextProps.process;
  
  // Quick reference check
  if (prev === next) return true;
  
  // Check if key properties changed (with threshold for floating point)
  const cpuChanged = Math.abs((prev.cpu || 0) - (next.cpu || 0)) > 0.01;
  const memoryChanged = prev.memory !== next.memory;
  const memPercentChanged = Math.abs((prev.memoryPercent || 0) - (next.memoryPercent || 0)) > 0.01;
  const nameChanged = prev.name !== next.name;
  const pidChanged = prev.pid !== next.pid;
  const statusChanged = prev.status !== next.status;
  const indexChanged = prevProps.index !== nextProps.index;
  
  // Only re-render if something actually changed
  return !(cpuChanged || memoryChanged || memPercentChanged || nameChanged || pidChanged || statusChanged || indexChanged);
});

ProcessRow.displayName = 'ProcessRow';

export default ProcessRow;
