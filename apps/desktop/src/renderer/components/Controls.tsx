import { useId, useLayoutEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import { X } from 'lucide-react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'icon';
};

export function Button({ variant = 'quiet', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`button button--${variant} ${className}`} {...props} />;
}

export function IconButton({ label, children, ...props }: Omit<ButtonProps, 'variant'> & { label: string }) {
  return (
    <span className="tooltip-anchor">
      <Button variant="icon" aria-label={label} {...props}>{children}</Button>
      <span className="tooltip" aria-hidden="true">{label}</span>
    </span>
  );
}

export function Input({ className = '', ...props }: ComponentPropsWithRef<"input">) {
  return <input className={`input ${className}`} {...props} />;
}

export function Dialog({
  title, onClose, children, className = '', hideHeader = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  hideHeader?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    element?.querySelector<HTMLElement>('[data-dialog-focus]')?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      className={`dialog ${className}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="dialog-inner">
        <div className={hideHeader ? 'sr-only' : 'dialog-heading'}>
          <h2 id={id}>{title}</h2>
          {!hideHeader && <IconButton label="Close dialog" onClick={onClose}><X size={16} /></IconButton>}
        </div>
        {children}
      </div>
    </dialog>
  );
}
