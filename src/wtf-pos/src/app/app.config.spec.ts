import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('appConfig', () => {
  it('exposes a non-empty provider list', () => {
    expect(appConfig.providers.length).toBeGreaterThanOrEqual(4);
  });

  it('wires the route table into the router', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(Router).config).toEqual(routes);
  });

  it('provides HttpClient', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(HttpClient)).toBeInstanceOf(HttpClient);
  });
});
