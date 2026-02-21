import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { CreateUserDto, GetUsersQuery, UpdateUserDto, UserDto } from '@shared/models';
import { environment } from '@environments/environment.development';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly baseUrl = `${environment.apiUrl}/users`;

  private readonly http = inject(HttpClient);

  public getUsers(query?: GetUsersQuery): Observable<UserDto[]> {
    let params = new HttpParams();

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params = params.set(key, String(value));
        }
      });
    }

    return this.http.get<UserDto[]>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching users:', error);

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to fetch users. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getUserById(id: string): Observable<UserDto> {
    return this.http.get<UserDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching user:', error);

        const errorMessage =
          error.status === 404
            ? 'User not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to fetch user. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public createUser(dto: CreateUserDto): Observable<UserDto> {
    return this.http.post<UserDto>(this.baseUrl, dto).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating user:', error);

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to create user. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public updateUser(dto: UpdateUserDto): Observable<UserDto> {
    return this.http.put<UserDto>(`${this.baseUrl}/${dto.id}`, dto).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating user:', error);

        const errorMessage =
          error.status === 404
            ? 'User not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to update user. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting user:', error);

        const errorMessage =
          error.status === 404
            ? 'User not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to delete user. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public uploadUserImage(id: string, file: File): Observable<UserDto> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<UserDto>(`${this.baseUrl}/${id}/images`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error uploading user image:', error);

        let errorMessage = 'Failed to upload image. Please try again later.';

        if (error.status === 400) {
          errorMessage = error.error || 'Invalid file. Please check file type and size.';
        } else if (error.status === 404) {
          errorMessage = 'User not found.';
        } else if (error.status === 0) {
          errorMessage = 'Unable to connect to server. Please check your connection.';
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteUserImage(id: string): Observable<UserDto> {
    return this.http.delete<UserDto>(`${this.baseUrl}/${id}/images`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting user image:', error);

        let errorMessage = 'Failed to delete image. Please try again later.';

        if (error.status === 404) {
          errorMessage = 'User or image not found.';
        } else if (error.status === 0) {
          errorMessage = 'Unable to connect to server. Please check your connection.';
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }
}
