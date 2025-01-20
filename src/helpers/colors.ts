// Converts a hex color to RGBA with specified opacity
export function hexToRGBA(hex: string, opacity: number): string {
    hex = hex.replace(/^#/, '');
    if (!/^([0-9A-F]{3}){1,2}$/i.test(hex)) {
        throw new Error("Invalid hex color format.");
    }

    const getRGB = (h: string) => {
        return h.length === 3
            ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
            : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };

    const [r, g, b] = getRGB(hex);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Adjusts the opacity of a color (hex, rgb, or rgba)
export function setOpacity(color: string, newOpacity: number): string {
    if (color.startsWith('#')) {
        return hexToRGBA(color, newOpacity);
    } else {
        // Match rgb or rgba
        const rgbRegex = /^rgb(a)?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:,\s*([\d.]+))?\)/i;
        const match = color.match(rgbRegex);

        if (match) {
            const r = match[2];
            const g = match[3];
            const b = match[4];
            // If alpha not specified, assume 1.0
            const a = match[1] ? (match[5] ?? '1') : '1';
            return `rgba(${r}, ${g}, ${b}, ${newOpacity??a})`;
    } else {
        throw new Error("Unsupported color format. Use hex, rgb, or rgba.");
    }
}
}

// Scales the alpha of an RGBA color by a fraction. 
// If the color isn't in rgba format, convert it to rgba with 'setOpacity', then re-apply scaleAlpha.
export function scaleAlpha(color: string, fraction: number): string {
    // This regex matches rgba(r, g, b, a) with optional spaces
    const rgbaRegex = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i;
    const rgbaMatch = color.match(rgbaRegex);

    if (!rgbaMatch) {
        // Convert to an rgba with fraction as newOpacity first
        const convertedColor = setOpacity(color, fraction);
        // Now convertedColor is rgba(...), apply scaleAlpha again to scale alpha proportionally
        return scaleAlpha(convertedColor, fraction);
    }

    const r = parseFloat(rgbaMatch[1]);
    const g = parseFloat(rgbaMatch[2]);
    const b = parseFloat(rgbaMatch[3]);
    const baseA = parseFloat(rgbaMatch[4]);

    const newA = baseA * fraction;
    return `rgba(${r},${g},${b},${newA})`;
}


// Darkens a color (hex or rgba) by a specified amount
export function darkenColor(color: string, amount: number = 0.2): string {
    const hexToRgb = (hex: string) => {
        hex = hex.replace(/^#/, '');
        return hex.length === 3
            ? [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)]
            : [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    };

    const rgbaToArray = (rgba: string) => rgba.match(/\d+(\.\d+)?/g)!.map(Number);
    
    let [r, g, b, a = 1] = color.startsWith('#')
        ? [...hexToRgb(color), 1]
        : rgbaToArray(color);

    r = Math.max(0, Math.min(255, r * (1 - amount)));
    g = Math.max(0, Math.min(255, g * (1 - amount)));
    b = Math.max(0, Math.min(255, b * (1 - amount)));

    return color.startsWith('#')
        ? `#${((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1)}`
        : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}
