/**
 * Pulls the Telebirr "Transaction Number" (e.g. "DH11G2Q7VJ") out of raw OCR
 * text from a screenshot of the app's "Successful" confirmation screen. This
 * is deliberately the ONLY thing OCR is trusted for  the extracted number is
 * just a lookup key handed to TelebirrReceiptVerifierService.verifyReceipt(),
 * which fetches the real Ethiotelecom receipt page and is the actual source
 * of truth for amount/payer/status. A misread digit here just means "receipt
 * not found" on the verified fetch, never a wrong credited amount.
 */

const LABEL_RE = /transaction\s*(?:number|no\.?|#)?/i;

// Telebirr's known code shape: 2 letters + 7-11 more alnum chars (e.g. "DH11G2Q7VJ").
const SHAPE_RE = /[A-Z]{2}[A-Z0-9]{7,11}/g;

/** A plain English word (e.g. "TRANSACTION", "SUPERSPORT") never contains a
 * digit  real Telebirr codes always do  so this is what tells a genuine
 * code apart from OCR'd label text or ad-banner copy that happens to match
 * the bare shape regex. */
function firstShapeWithDigit(text: string): string | null {
    const matches = text.toUpperCase().match(SHAPE_RE);
    return matches?.find((m) => /[0-9]/.test(m)) ?? null;
}

export function extractTelebirrTxnNumber(
    ocrText: string | null | undefined,
): string | null {
    if (!ocrText) return null;
    const text = ocrText.replace(/[|]/g, ' ');

    // 1. Anchor on the label, then look at exactly what follows it  slicing the
    // label out first (rather than one combined regex) avoids the label word
    // itself ("Number") getting backtracked into the value capture.
    const labelMatch = LABEL_RE.exec(text);
    if (labelMatch) {
        const rest = text.slice(labelMatch.index + labelMatch[0].length);
        const valueMatch = rest.match(/^[\s:\-]*([A-Za-z0-9]{6,15})/);
        if (valueMatch) return valueMatch[1].toUpperCase();

        // 2. Label found but nothing plausible immediately after it (e.g. OCR put
        // a noise line in between)  scan the next couple of lines for the shape,
        // starting AFTER the label's own line so "TRANSACTION"/"NUMBER" can't
        // match themselves.
        const lines = text.split(/\r?\n/);
        const labelLineIdx = lines.findIndex((line) => LABEL_RE.test(line));
        if (labelLineIdx !== -1) {
            for (
                let i = labelLineIdx + 1;
                i < Math.min(labelLineIdx + 3, lines.length);
                i++
            ) {
                const shape = firstShapeWithDigit(lines[i]);
                if (shape) return shape;
            }
        }
    }

    // 3. Last resort: no label anywhere  scan the whole text for a token
    // matching Telebirr's code shape that also contains a digit.
    return firstShapeWithDigit(text);
}
