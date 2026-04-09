module.exports.generateRandomNumber = (length) => {
  const data = "0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += data.charAt(Math.floor(Math.random() * data.length));
  }
  return result;
};
const normalize = (str) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .toUpperCase();
};
module.exports.generateCodeVariant = (material, color, size) => {
  return `SP-${normalize(material)}-${normalize(color)}-${size}`;
};
