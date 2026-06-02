import { useEffect, useRef, useState } from "react";
import { docTypeLabel, displayDocumentFileName } from "../../shared/fileName";

type InvoiceDoc = {
  id: string;
  type: string;
  fileName: string;
  filePath: string;
  createdAt: string;
};

type Props = {
  apiUrl: string;
  canWrite?: boolean;
  receiptId?: string;
  token?: string | null;
  fetchWithSession?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  invoiceDoc?: InvoiceDoc | null;
  onUploadFile: (file: File) => void | Promise<boolean | void>;
  onOpenInvoice?: () => void;
  onUploaded?: () => void;
  compact?: boolean;
};

export function ReceiptInvoiceAttachBar({
  apiUrl,
  canWrite = true,
  receiptId,
  token,
  fetchWithSession,
  invoiceDoc: invoiceDocProp,
  onUploadFile,
  onOpenInvoice,
  onUploaded,
  compact = false
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fetchedInvoice, setFetchedInvoice] = useState<InvoiceDoc | null>(null);

  useEffect(() => {
    if (invoiceDocProp !== undefined || !receiptId || !token || !fetchWithSession) return;
    let cancelled = false;
    void fetchWithSession(`${apiUrl}/api/receipt-requests/${encodeURIComponent(receiptId)}/invoice`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setFetchedInvoice(null);
          return;
        }
        const doc = (await res.json()) as InvoiceDoc;
        if (!cancelled) setFetchedInvoice(doc);
      })
      .catch(() => {
        if (!cancelled) setFetchedInvoice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, receiptId, token, fetchWithSession, invoiceDocProp]);

  const invoiceDoc = invoiceDocProp !== undefined ? invoiceDocProp : fetchedInvoice;
  const title = invoiceDoc
    ? displayDocumentFileName(invoiceDoc.fileName, {
        type: invoiceDoc.type,
        createdAt: invoiceDoc.createdAt
      })
    : null;

  return (
    <section className={`receiptInvoiceBar${compact ? " receiptInvoiceBar--compact" : ""}`}>
      <div className="receiptInvoiceBarHead">
        <div>
          <strong>Счёт поставщика</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Привязан к этой заявке — доступен при приёмке и в документах.
          </p>
        </div>
        <div className="receiptInvoiceBarActions">
          {invoiceDoc && onOpenInvoice ? (
            <button type="button" className="ghostBtn" onClick={onOpenInvoice}>
              Открыть счёт
            </button>
          ) : null}
          {canWrite ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,image/*,application/pdf"
                className="srOnly"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void Promise.resolve(onUploadFile(f)).then(() => {
                      onUploaded?.();
                      if (receiptId && token && fetchWithSession) {
                        void fetchWithSession(
                          `${apiUrl}/api/receipt-requests/${encodeURIComponent(receiptId)}/invoice`,
                          { headers: { Authorization: `Bearer ${token}` } }
                        )
                          .then(async (res) => {
                            if (res.ok) setFetchedInvoice((await res.json()) as InvoiceDoc);
                          })
                          .catch(() => undefined);
                      }
                    });
                  }
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="primaryBtn"
                onClick={() => inputRef.current?.click()}
              >
                {invoiceDoc ? "Заменить счёт" : "Добавить счёт"}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {invoiceDoc ? (
        <a
          href={`${apiUrl}/${invoiceDoc.filePath}`}
          target="_blank"
          rel="noreferrer"
          className="receiptInvoiceBarFile"
          download={title || undefined}
        >
          <span className="receiptInvoiceBarFileName" title={title || ""}>
            {title}
          </span>
          <span className="badge neutral">{docTypeLabel(invoiceDoc.type)}</span>
        </a>
      ) : (
        <p className="muted receiptInvoiceBarEmpty">Счёт ещё не приложён к заявке.</p>
      )}
    </section>
  );
}
