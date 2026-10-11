import { FormControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { SearchInputComponent } from './search-input';

describe('SearchInputComponent', () => {
  function setup(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(SearchInputComponent);
    Object.entries(inputs).forEach(([k, v]) => fixture.componentRef.setInput(k, v));
    const changed = vi.fn();
    fixture.componentInstance.valueChange.subscribe(changed);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      changed,
      el,
      input: () => el.querySelector('input') as HTMLInputElement,
      clearBtn: () => el.querySelector('button') as HTMLButtonElement | null,
    };
  }

  it('renders placeholder and aria label defaults', () => {
    const { input } = setup();
    expect(input().placeholder).toBe('Search');
    expect(input().getAttribute('aria-label')).toBe('Search');
    expect(input().type).toBe('search');
  });

  it('applies custom placeholder and aria label', () => {
    const { input } = setup({ placeholder: 'Find item', ariaLabel: 'Find' });
    expect(input().placeholder).toBe('Find item');
    expect(input().getAttribute('aria-label')).toBe('Find');
  });

  describe('value mode', () => {
    it('shows the value and no clear button when empty', () => {
      const { input, clearBtn } = setup({ value: '' });
      expect(input().value).toBe('');
      expect(clearBtn()).toBeNull();
    });

    it('hides clear button for whitespace-only values', () => {
      const { clearBtn } = setup({ value: '   ' });
      expect(clearBtn()).toBeNull();
    });

    it('shows the clear button when there is a value', () => {
      const { input, clearBtn } = setup({ value: 'abc' });
      expect(input().value).toBe('abc');
      expect(clearBtn()).toBeTruthy();
      expect(clearBtn()!.getAttribute('aria-label')).toBe('Clear search');
    });

    it('emits valueChange when typing', () => {
      const { input, changed } = setup();
      input().value = 'milk';
      input().dispatchEvent(new Event('input'));
      expect(changed).toHaveBeenCalledWith('milk');
    });

    it('emits an empty string when cleared', () => {
      const { clearBtn, changed } = setup({ value: 'abc' });
      clearBtn()!.click();
      expect(changed).toHaveBeenCalledWith('');
    });

    it('disables the input and clear button when disabled', () => {
      const { input, clearBtn } = setup({ value: 'abc', disabled: true });
      expect(input().disabled).toBe(true);
      expect(clearBtn()!.disabled).toBe(true);
    });
  });

  describe('control mode', () => {
    it('binds to the form control', () => {
      const control = new FormControl<string | null>('hello');
      const { input, clearBtn } = setup({ control });
      expect(input().value).toBe('hello');
      expect(clearBtn()).toBeTruthy();
    });

    it('updates the control when typing', () => {
      const control = new FormControl<string | null>('');
      const { input, fixture, clearBtn, changed } = setup({ control });
      input().value = 'abc';
      input().dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(control.value).toBe('abc');
      expect(clearBtn()).toBeTruthy();
      expect(changed).not.toHaveBeenCalled();
    });

    it('clears the control instead of emitting', () => {
      const control = new FormControl<string | null>('abc');
      const { clearBtn, fixture, input, changed } = setup({ control });
      clearBtn()!.click();
      fixture.detectChanges();
      expect(control.value).toBe('');
      expect(input().value).toBe('');
      expect(clearBtn()).toBeNull();
      expect(changed).not.toHaveBeenCalled();
    });

    it('treats a null control value as empty', () => {
      const control = new FormControl<string | null>(null);
      const { clearBtn } = setup({ control });
      expect(clearBtn()).toBeNull();
    });

    it('disables the clear button when the control is disabled', () => {
      const control = new FormControl<string | null>({ value: 'abc', disabled: true });
      const { clearBtn } = setup({ control });
      expect(clearBtn()!.disabled).toBe(true);
    });
  });
});
