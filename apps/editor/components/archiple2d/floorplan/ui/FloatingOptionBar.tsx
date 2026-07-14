// @ts-nocheck
import React from 'react';
import { FlipHorizontal, FlipVertical, Trash2, Lock, Copy } from 'lucide-react';

interface FloatingOptionBarProps {
    x: number;
    y: number;
    visible: boolean;
    onFlipHorizontal: () => void;
    onFlipVertical: () => void;
    onDelete: () => void;
    onCopy?: () => void;
    onLock?: () => void;
}

export const FloatingOptionBar: React.FC<FloatingOptionBarProps> = ({
    x,
    y,
    visible,
    onFlipHorizontal,
    onFlipVertical,
    onDelete,
    onCopy,
    onLock
}) => {
    if (!visible) return null;

    // Modern professional style
    const style: React.CSSProperties = {
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, calc(-100% - 16px))', // Center horizontally, place above with more spacing
        backgroundColor: '#1F1F1F', // Darker, more professional
        borderRadius: '8px', // More rounded for modern look
        padding: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1)', // Elevated shadow with subtle border
        zIndex: 1000,
        pointerEvents: 'auto',
        backdropFilter: 'blur(8px)',
    };

    const buttonStyle: React.CSSProperties = {
        background: 'transparent',
        border: 'none',
        color: '#E8E8E8',
        cursor: 'pointer',
        padding: '8px',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        width: '36px',
        height: '36px',
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = '#2D2D2D';
        e.currentTarget.style.transform = 'scale(1.05)';
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.transform = 'scale(1)';
    };

    const handleDeleteEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        e.currentTarget.style.transform = 'scale(1.05)';
    };

    return (
        <div style={style} onMouseDown={(e) => e.stopPropagation()}>
            <button
                style={buttonStyle}
                onClick={onFlipHorizontal}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                title="Flip Horizontal"
                aria-label="Flip Horizontal"
            >
                <FlipHorizontal size={20} strokeWidth={1.5} />
            </button>
            <button
                style={buttonStyle}
                onClick={onFlipVertical}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                title="Flip Vertical"
                aria-label="Flip Vertical"
            >
                <FlipVertical size={20} strokeWidth={1.5} />
            </button>

            {onCopy && (
                <button
                    style={buttonStyle}
                    onClick={onCopy}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    title="Copy"
                    aria-label="Copy"
                >
                    <Copy size={20} strokeWidth={1.5} />
                </button>
            )}

            {onLock && (
                <button
                    style={buttonStyle}
                    onClick={onLock}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    title="Lock"
                    aria-label="Lock"
                >
                    <Lock size={20} strokeWidth={1.5} />
                </button>
            )}

            <div style={{
                width: '1px',
                height: '24px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                margin: '0 4px'
            }} />

            <button
                style={{ ...buttonStyle, color: '#EF4444' }}
                onClick={onDelete}
                onMouseEnter={handleDeleteEnter}
                onMouseLeave={handleMouseLeave}
                title="Delete"
                aria-label="Delete"
            >
                <Trash2 size={20} strokeWidth={1.5} />
            </button>
        </div>
    );
};
