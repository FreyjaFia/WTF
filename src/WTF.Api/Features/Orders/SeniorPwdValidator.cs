using WTF.Api.Features.Orders.DTOs;
using WTF.Calculations.Orders;

namespace WTF.Api.Features.Orders;

internal static class SeniorPwdValidator
{
    public const int MaxIdLength = 50;
    public const int MaxNameLength = 100;

    public static List<SeniorPwdPersonRequestDto> Clean(IEnumerable<SeniorPwdPersonRequestDto> persons, bool held) =>
        persons.Select(person => CleanPerson(person, held)).ToList();

    public static void Validate(IReadOnlyCollection<SeniorPwdPersonRequestDto> persons, bool requireIdChecked)
    {
        foreach (var person in persons)
        {
            Validate(person, requireIdChecked);
        }

        if (persons.Select(p => SeniorPwdRules.IdKey(p.IdNumber)).Distinct().Count() != persons.Count)
        {
            throw new InvalidOperationException("The same ID number cannot be used twice on one order.");
        }
    }

    private static SeniorPwdPersonRequestDto CleanPerson(SeniorPwdPersonRequestDto person, bool held)
    {
        var idNumber = SeniorPwdRules.NormalizeIdNumber(person.IdNumber);
        var name = (person.CustomerName ?? string.Empty).Trim();
        if (held)
        {
            idNumber = idNumber.Length > MaxIdLength ? idNumber[..MaxIdLength] : idNumber;
            name = name.Length > MaxNameLength ? name[..MaxNameLength] : name;
        }

        return person with { IdNumber = idNumber, CustomerName = name };
    }

    private static void Validate(SeniorPwdPersonRequestDto person, bool requireIdChecked)
    {
        if (!Enum.IsDefined(person.Type))
        {
            throw new InvalidOperationException("Pick Senior or PWD for the discount.");
        }

        if (person.IdNumber.Length == 0 || person.CustomerName.Length == 0)
        {
            throw new InvalidOperationException("The Senior/PWD discount needs the ID number and the name on the ID.");
        }

        if (person.IdNumber.Length > MaxIdLength || person.IdNumber.Any(char.IsControl))
        {
            throw new InvalidOperationException($"The ID number is not valid ({MaxIdLength} characters at most).");
        }

        if (person.CustomerName.Length > MaxNameLength || person.CustomerName.Any(char.IsControl))
        {
            throw new InvalidOperationException($"The name on the ID is not valid ({MaxNameLength} characters at most).");
        }

        if (requireIdChecked && !person.IdChecked)
        {
            throw new InvalidOperationException("Check the ID before applying the Senior/PWD discount to an online order.");
        }
    }
}
