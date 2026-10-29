using MediatR;
using System.ComponentModel.DataAnnotations;

namespace WTF.Api.Common.Validation;

public class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        var results = new List<ValidationResult>();
        if (!Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true))
        {
            // The global exception handling turns an ArgumentException into a 400 with a plain message.
            var message = string.Join(" ", results.Select(result => result.ErrorMessage).Where(text => !string.IsNullOrWhiteSpace(text)));
            throw new ArgumentException(message);
        }

        return next(cancellationToken);
    }
}
