import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaginationComponent } from './pagination';

describe('PaginationComponent', () => {
  let fixture: ComponentFixture<PaginationComponent>;

  function setup(page: number, pageSize: number, totalCount: number): HTMLElement {
    fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('page', page);
    fixture.componentRef.setInput('pageSize', pageSize);
    fixture.componentRef.setInput('totalCount', totalCount);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [PaginationComponent] }));

  it('shows nothing when there are no rows', () => {
    expect(setup(1, 25, 0).querySelector('nav')).toBeNull();
  });

  it('shows the visible range and total', () => {
    expect(setup(2, 25, 61).textContent).toContain('26 – 50 of 61');
  });

  it('marks the current page and emits the clicked page', () => {
    const el = setup(2, 25, 100);
    const spy = vi.fn();
    fixture.componentInstance.pageChange.subscribe(spy);
    const current = el.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.textContent?.trim()).toBe('2');
    (el.querySelector('[aria-label="Page 4"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith(4);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const first = setup(1, 25, 60);
    const buttons = Array.from(first.querySelectorAll('nav button')) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[buttons.length - 1].disabled).toBe(false);
  });

  it('emits a page size change only for listed sizes', () => {
    const el = setup(1, 25, 100);
    const spy = vi.fn();
    fixture.componentInstance.pageSizeChange.subscribe(spy);
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(50);
  });
});
