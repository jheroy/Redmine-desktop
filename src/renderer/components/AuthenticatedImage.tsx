import React, { useEffect, useState, memo } from 'react';

interface AuthenticatedImageProps {
    src: string;
    alt?: string;
    style?: React.CSSProperties;
    className?: string;
    fetchBlob: (url: string) => Promise<Blob> | undefined;
    onClick?: (e: React.MouseEvent) => void;
    onMouseDown?: (e: React.MouseEvent) => void;
}

// Global image blob cache to prevent re-fetching
const imageBlobCache = new Map<string, string>();

const AuthenticatedImageComponent: React.FC<AuthenticatedImageProps> = ({ src, alt, style, className, fetchBlob, onClick, onMouseDown }) => {
    const [objectUrl, setObjectUrl] = useState<string | null>(() => {
        // Check cache on initial render
        return imageBlobCache.get(src) || null;
    });
    const [error, setError] = useState(false);

    useEffect(() => {
        // If already cached, use cached url
        const cached = imageBlobCache.get(src);
        if (cached) {
            setObjectUrl(cached);
            return;
        }

        let isMounted = true;

        async function loadImage() {
            try {
                const blob = await fetchBlob(src);
                if (blob && isMounted) {
                    const url = URL.createObjectURL(blob);
                    // Cache the blob URL
                    imageBlobCache.set(src, url);
                    setObjectUrl(url);
                }
            } catch (e) {
                console.error(`[AuthenticatedImage] Failed to load image: ${src}`, e);
                if (isMounted) setError(true);
            }
        }

        if (src) {
            loadImage();
        }

        return () => {
            isMounted = false;
            // Don't revoke cached URLs - they're shared
        };
    }, [src]); // Only depend on src, not fetchBlob

    if (error) return <div style={{ ...style, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Failed to load image</div>;
    if (!objectUrl) return <div style={{ ...style, background: '#222' }} />;

    return <img src={objectUrl} alt={alt} style={style} className={className} onClick={onClick} onMouseDown={onMouseDown} />;
};

// Memoize to prevent re-render when parent re-renders but src hasn't changed
export const AuthenticatedImage = memo(AuthenticatedImageComponent, (prevProps, nextProps) => {
    // Only re-render if src changes
    return prevProps.src === nextProps.src;
});
