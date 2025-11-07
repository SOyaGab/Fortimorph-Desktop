/**
 * Reusable Confirmation Modal Component
 * 
 * A styled confirmation dialog that replaces plain alert() and confirm() calls
 * following the Ocean Vibe design system.
 */

import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Info, X } from 'lucide-react';

const ConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  type = 'confirm', // 'confirm', 'alert', 'warning', 'error', 'success'
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  showCancel = true,
  children
}) => {
  // Handle ESC key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'warning':
        return <AlertTriangle className="w-8 h-8 text-yellow-400" />;
      case 'error':
        return <XCircle className="w-8 h-8 text-red-400" />;
      case 'success':
        return <CheckCircle className="w-8 h-8 text-green-400" />;
      case 'alert':
        return <Info className="w-8 h-8 text-blue-400" />;
      case 'confirm':
      default:
        return <AlertTriangle className="w-8 h-8 text-blue-400" />;
    }
  };

  const getColors = () => {
    switch (type) {
      case 'warning':
        return {
          bg: 'bg-yellow-500/20',
          border: 'border-yellow-500/50',
          iconBg: 'bg-yellow-500/20',
          confirmBtn: 'bg-yellow-500 hover:bg-yellow-600'
        };
      case 'error':
        return {
          bg: 'bg-red-500/20',
          border: 'border-red-500/50',
          iconBg: 'bg-red-500/20',
          confirmBtn: 'bg-red-500 hover:bg-red-600'
        };
      case 'success':
        return {
          bg: 'bg-green-500/20',
          border: 'border-green-500/50',
          iconBg: 'bg-green-500/20',
          confirmBtn: 'bg-green-500 hover:bg-green-600'
        };
      case 'alert':
        return {
          bg: 'bg-blue-500/20',
          border: 'border-blue-500/50',
          iconBg: 'bg-blue-500/20',
          confirmBtn: 'bg-blue-500 hover:bg-blue-600'
        };
      case 'confirm':
      default:
        return {
          bg: 'bg-blue-500/20',
          border: 'border-blue-500/50',
          iconBg: 'bg-blue-500/20',
          confirmBtn: 'bg-green-500 hover:bg-green-600'
        };
    }
  };

  const colors = getColors();

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-slate-800 rounded-xl shadow-2xl border border-gray-700 max-w-md w-full animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${colors.iconBg} rounded-lg`}>
              {getIcon()}
            </div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {children || (
            <p className="text-gray-300 text-base leading-relaxed whitespace-pre-line">
              {message}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-6 border-t border-gray-700">
          {showCancel && (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={() => {
              if (onConfirm) onConfirm();
              onClose();
            }}
            className={`flex-1 px-4 py-2.5 ${colors.confirmBtn} text-white rounded-lg font-medium transition-colors`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
