/**
 * Detect a document by its magic bytes instead of trusting the browser's
 * `File.type`. Executables and other disguised files are rejected here as well
 * as by the storage bucket's allowed MIME list and the send RPC's path check.
 */
export type DocumentMime =
	| 'application/pdf'
	| 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	| 'application/msword';

const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function ascii(bytes: Uint8Array) {
	return String.fromCharCode(...bytes);
}

export async function detectDocumentMime(file: File): Promise<DocumentMime | null> {
	let head: Uint8Array;
	try {
		head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
	} catch {
		return null;
	}

	const name = file.name.toLowerCase();
	const header = ascii(head.slice(0, 8));

	// Executables: DOS MZ stub or PE header. Never allow these through.
	if (header.slice(0, 2) === 'MZ') return null;

	if (ascii(head.slice(0, 5)) === '%PDF-' && name.endsWith('.pdf')) {
		return 'application/pdf';
	}

	if (ascii(head.slice(0, 4)) === 'PK\x03\x04' && name.endsWith('.docx')) {
		// A DOCX is a ZIP with an Office content-types manifest. Checking for it
		// keeps an arbitrary renamed ZIP from being presented as a Word file.
		if (ascii(head).includes('[Content_Types].xml')) {
			return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		}
	}

	if (OLE2_SIGNATURE.every((value, index) => head[index] === value) && name.endsWith('.doc')) {
		return 'application/msword';
	}

	return null;
}

/** Human-readable extension for a validated document MIME type. */
export function documentExtension(mime: DocumentMime) {
	if (mime === 'application/pdf') return 'pdf';
	if (mime === 'application/msword') return 'doc';
	return 'docx';
}
