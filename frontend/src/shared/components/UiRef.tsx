import React from 'react';
import './UiRef.scss';

interface UiRefProps {
  children: React.ReactNode;
  /**
   * When supplied the reference becomes a link. Leave it off for a purely
   * visual reference — the surrounding prose already says what it refers to,
   * so there is nothing for the reader to navigate to.
   */
  href?: string;
  /** Open `href` in a new tab. Use for destinations outside this site. */
  external?: boolean;
  className?: string;
  title?: string;
}

/**
 * Marks up a run of prose as naming a control in the app rather than as prose
 * itself, e.g. "the <UiRef>Auto Notebook Withdraw</UiRef> button".
 *
 * Deliberately a <span> (or <a>), never a <button>: it has no action, and
 * theme.scss styles every real `button` as a solid primary-filled control, so
 * using one here would both lie to assistive tech and render wrong.
 */
const UiRef: React.FC<UiRefProps> = ({ children, href, external, className, title }) => {
  const classes = ['ui-ref', className].filter(Boolean).join(' ');

  if (!href) {
    return (
      <span className={classes} title={title}>
        {children}
      </span>
    );
  }

  return (
    <a
      className={classes}
      href={href}
      title={title}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
};

export default UiRef;
