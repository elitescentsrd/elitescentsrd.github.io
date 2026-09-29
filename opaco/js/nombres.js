// Diccionarios de nombres de pila y apellidos frecuentes en España (y los más habituales entre la población extranjera
// residente). Solo se usan para reconocer personas cuando no hay otra pista (un "D.", un "Trabajador:"...).
// Se comparan en mayúsculas y sin tildes, así que "María", "MARIA" y "maría" cuentan igual.

const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
const set = text => new Set(text.split(/[\s,]+/).filter(Boolean).map(norm));

export const FIRST_NAMES = set(`
Antonio José Jose Manuel Francisco David Juan Javier Daniel Carlos Jesús Alejandro Miguel Rafael Pablo Pedro Ángel Sergio
Fernando Jorge Luis Alberto Álvaro Adrián Diego Raúl Enrique Ramón Vicente Iván Rubén Óscar Andrés Joaquín Santiago Eduardo
Víctor Roberto Jaime Mario Ignacio Alfonso Salvador Ricardo Marcos Jordi Emilio Julián Julio Guillermo Gabriel Tomás Agustín
Marc Gonzalo Félix Hugo Lucas Martín Nicolás Samuel Ismael Cristian Christian Aitor Iker Unai Asier Xabier Mikel Jon Ander Gorka
Iñaki Iñigo Borja Rodrigo Mateo Izan Marco Álex Alex Eric Pol Arnau Oriol Pau Sergi Xavier Josep Joan Jaume Lluís Albert
Ferran Gerard Bruno Héctor Hèctor Arturo Esteban Felipe Gregorio Lorenzo Mariano Domingo Benito Bernardo Cristóbal Sebastián
Teodoro Valentín Aurelio Ernesto Gustavo Germán Hernán Humberto Marcelo Mauricio Maximiliano Nelson Octavio Orlando Patricio
Reinaldo Rogelio Rolando Saúl Simón Tobías Ulises Wilson Xosé Brais Anxo Iago Nacho Paco Pepe Manolo Kevin Jonathan Aarón Abel
Abraham Adolfo Alfredo Amador Ambrosio Anselmo Armando Arsenio Baltasar Bartolomé Basilio Benjamín Blas Casimiro Ceferino César
Clemente Conrado Cosme Darío Dionisio Efrén Eladio Elías Eloy Emiliano Eugenio Evaristo Ezequiel Fabián Faustino Federico
Fermín Fidel Florentino Fulgencio Gerardo Gilberto Heriberto Hilario Honorio Horacio Isaac Isidoro Isidro Jacinto Jacobo
Jerónimo Joel Josué Laureano Leandro Leonardo Leopoldo Lisandro Lucio Luciano Macario Marcelino Marcial Matías Maximino Melchor
Moisés Narciso Natalio Nazario Noé Pascual Plácido Porfirio Primitivo Prudencio Ramiro Raimundo Rigoberto Roque Rosendo Rufino
Saturnino Serafín Severino Silvestre Silvio Sixto Tadeo Timoteo Urbano Valeriano Venancio Vidal Virgilio Zacarías Íñigo Lucio
Mohamed Mohammed Muhammad Ahmed Ali Omar Youssef Yousef Hassan Karim Rachid Said Abdel Abdelkader Mustafa Hamza Bilal Ion Vasile
Andrei Mihai Alexandru Constantin Florin Gheorghe John Michael Peter Paul Thomas James Robert William Richard George Mark Stefan
Luca Giuseppe Francesco Pierre Jean Dmitri Sergei Oleksandr Wilmer Yeison Brayan Jhon Edwin Fredy Freddy Wilfredo Alexis
María Maria Carmen Ana Isabel Laura Cristina Marta Dolores Francisca Lucía Antonia Mercedes Sara Paula Elena Pilar Raquel Rosa
Concepción Manuela Beatriz Nuria Núria Silvia Julia Júlia Patricia Irene Encarnación Montserrat Andrea Rocío Mónica Alba Rosario
Teresa Sonia Sandra Marina Ángela Susana Natalia Yolanda Margarita Claudia Eva Inmaculada Sofía Esther Josefa Noelia Verónica
Carolina Ángeles Nerea Daniela Victoria Amparo Lorena Alicia Inés Catalina Consuelo Miriam Ainhoa Olga Lidia Fátima Emilia
Gloria Clara Aurora Luisa Esperanza Celia Vanesa Vanessa Alejandra Martina Valeria Carla Noa Lola Jimena Ximena Triana Aitana
Ariadna Adriana Blanca Belén Nieves Soledad Remedios Milagros Asunción Purificación Trinidad Lourdes Begoña Arantxa Arantza
Itziar Maite Leire Amaia Irati Nahia Uxue Garazi Idoia Iratxe Edurne Ane Maialen Montse Meritxell Laia Mireia Anna Gemma Judit
Neus Roser Carme Xènia Aina Berta Ona Iria Uxía Antía Sabela Xiana Tamara Estefanía Jessica Tatiana Rebeca Débora Diana Elisa
Eugenia Fernanda Florencia Gabriela Graciela Guadalupe Irma Jazmín Josefina Juana Juliana Leticia Liliana Lina Luciana
Magdalena Marcela Maribel Marisa Marisol Mariana Micaela Miranda Nadia Norma Olivia Paola Priscila Regina Renata Romina Rut Ruth
Sabrina Salomé Samanta Sheila Silvana Stephanie Tania Valentina Virginia Viviana Yasmina Zaida Zoe Abril Agustina Ainara Alma
Amelia Anabel Araceli Azucena Candela Cecilia Chelo Clotilde Covadonga Elvira Emma Encarna Estela Eulalia Fabiola Felisa Gisela
Herminia Hortensia Isidora Ivana Jacinta Jennifer Joaquina Leonor Lucrecia Lydia Macarena Manoli Mari Maricarmen Matilde Mercè
Nazaret Noemí Ofelia Paloma Petra Piedad Rafaela Ramona Rosalía Sagrario Teodora Úrsula Vicenta Yaiza Yanira Zulema Khadija
Aicha Amina Ioana Mihaela Andreea Olena Svetlana Emily Sarah Elizabeth Mary Linda Barbara Susan Karen Nancy Lisa Anne Sophie
Giulia Chiara Francesca Yesenia Yuliana Leidy Marlene Maryam Salma Imane Nora Aurelia Custodia Obdulia Eusebia Eloísa Adela
`);

export const SURNAMES = set(`
García Rodríguez González Fernández López Martínez Sánchez Pérez Gómez Martín Jiménez Hernández Ruiz Díaz Moreno Muñoz Álvarez
Romero Gutiérrez Alonso Navarro Torres Domínguez Ramos Vázquez Ramírez Gil Serrano Morales Molina Blanco Suárez Castro Ortega
Delgado Ortiz Marín Rubio Núñez Medina Sanz Castillo Iglesias Cortés Garrido Santos Guerrero Lozano Cano Cruz Méndez Flores
Prieto Herrera Peña León Márquez Cabrera Gallego Calvo Vidal Campos Reyes Vega Fuentes Carrasco Díez Aguilar Caballero Nieto
Santana Vargas Pascual Giménez Herrero Hidalgo Montero Lorenzo Santiago Benítez Durán Ibáñez Arias Mora Ferrer Carmona Vicente
Rojas Soto Crespo Román Pastor Velasco Parra Sáez Moya Bravo Rivera Gallardo Soler Pardo Esteban Franco Merino Espinosa Lara
Izquierdo Rivas Silva Rivero Casado Arroyo Redondo Camacho Rey Vera Otero Luque Galán Montes Ríos Sierra Segura Carrillo Marcos
Martí Soriano Mendoza Robles Bernal Vila Valero Palacios Pereira Macías Varela Benito Andrés Guerra Bueno Mateo Villar Contreras
Miranda Roldán Aguilera Menéndez Guillén Beltrán Mateos Vallejo Calderón Padilla Salas Quintana Pacheco Acosta Aranda Jurado
Tomás Ávila Ponce Cuesta Rico Salazar Toledo Moral Ferrández Escudero Barrera Maldonado Paredes Pozo Trujillo Heredia Rincón
Solís Zamora Valencia Arenas Bermúdez Rosales Santamaría Figueroa Estévez Blázquez Villanueva Sosa Orozco Coronado Correa
Cordero Duque Echevarría Etxeberria Aguirre Arrieta Goikoetxea Garmendia Zubizarreta Urrutia Olaizola Puig Pujol Serra Roca
Vilaró Casals Riera Mas Font Sala Ribas Costa Batlle Bosch Castells Oliver Pons Llorens Sastre Fuster Rigo Castaño Seoane Rial
Fraga Pazos Lema Souto Vilas Barreiro Castiñeira Bouzas Mosquera Carballo Quiroga Villa Rosado Pinto Oliveira Ferreira Sousa
Almeida Rocha Mendes Alves Cardoso Teixeira Reis Chacón Mejía Ospina Restrepo Cárdenas Quintero Salinas Espinoza Vásquez
Peralta Villalobos Zapata Montoya Osorio Valdés Hurtado Tapia Sepúlveda Muñiz Robledo Cid Carretero Barroso Cabello Mena
Aparicio Gracia Bautista Ruano Solano Cuenca Vives Castellano Ballesteros Collado Manzano Pineda Rueda Salgado Toro Galindo
Bello Aguado Abad Alarcón Andrade Arce Ayala Baena Barrios Becerra Burgos Calero Cámara Cantero Carrión Casas Cerezo Chaves
Cobo Conde Córdoba Dorado Escobar Estrada Expósito Fajardo Ferrero Frías Gálvez Gámez Godoy Guzmán Lucas Luna Llorente Maroto
Mesa Millán Mira Montenegro Morán Moyano Nadal Naranjo Nevado Novoa Olmo Olmedo Ordóñez Oviedo Palomo Palomino Perales Polo
Porras Portillo Quesada Rojo Rosell Salcedo Sanchís Sancho Segovia Sola Tejada Tello Tirado Valverde Vergara Villegas Zamorano
Carbonell Gimeno Hierro Juárez Lorente Melero Moreira Pizarro Recio Sáenz Saiz Sainz Villalba Yáñez Zurita Popescu Ionescu
Smith Johnson Williams Brown Jones Miller Davis Wilson Taylor Müller Schmidt Rossi Bianchi Romano Martins Barbosa Nunes
Benavides Bejarano Bonilla Cabezas Carvajal Cepeda Clemente Criado Cuevas Dávila Elizondo Esteve Galiano Gaspar Granados
Hernando Huertas Lagos Lillo Linares Lobato Lobo Madrigal Manrique Marco Molero Montalvo Moreno Muñoz Ocaña Oliva Orellana
Pantoja Peinado Peral Plaza Poveda Quintanilla Rosillo Rubiales Salvador Santacruz Sevillano Taboada Tovar Ureña Valiente
Valle Vallés Vaquero Velázquez Ventura Viera Zambrano Zorrilla Amrani Bennani Alaoui Idrissi Tahiri Ouali Haddad
`);

// Palabras con mayúscula que nunca son parte de un nombre de persona (encabezados, meses, tipos de vía, siglas...).
export const NOT_NAME = set(`
DNI NIF NIE CIF Documento Documentos Página Hoja IBAN BIC SWIFT CCC CP NSS NAF IRPF IVA TOTAL EUR EUROS Euros Enero Febrero Marzo Abril Mayo Junio Agosto
Septiembre Setiembre Octubre Noviembre Diciembre Lunes Martes Miércoles Jueves Viernes Sábado Calle Avenida Avda Plaza
Paseo Camino Carretera Ronda Travesía Glorieta Urbanización Pasaje Rambla Vía Bulevar Contrato Factura Nómina Recibo Salario
Empresa Empresario Trabajador Trabajadora Cliente Titular Página Fecha Nombre Apellidos Domicilio Dirección Teléfono Móvil Email
Correo Firma Firmado Fdo Madrid Barcelona Valencia Sevilla Zaragoza Málaga Murcia Palma Bilbao Alicante Córdoba Valladolid Vigo
Gijón Granada Oviedo España Spain Reino Unido Seguridad Social Tesorería General Agencia Tributaria Hacienda Ministerio Juzgado
Tribunal Ayuntamiento Generalitat Junta Gobierno Banco Caja Bankinter Santander Sabadell BBVA CaixaBank Unicaja Ibercaja Kutxabank
Abanca Deutsche Openbank ING Concepto Importe Cantidad Base Cuota Retención Líquido Percibir Devengos Deducciones Periodo
Categoría Grupo Antigüedad Código Referencia Número Cuenta Mes Año Días Horas Precio Unidad Descripción Subtotal Observaciones
Cláusula Primera Segunda Tercera Cuarta Quinta Sexta Séptima Octava Novena Décima Parte Partes Exponen Reunidos Intervienen
Estipulaciones Arrendador Arrendadora Arrendatario Arrendataria Inquilino Inquilina Propietario Propietaria Comprador Compradora
Vendedor Vendedora Fiador Avalista Representante Administrador Administradora Anexo Artículo Ley Real Decreto Orden Estatuto Convenio Colectivo Provincia Localidad Municipio Código Postal
`);

export const COMPANY_SUFFIX = /^(?:S\.?\s?L\.?(?:\s?U\.?)?|S\.?\s?A\.?(?:\s?U\.?)?|S\.?\s?Coop\.?|S\.?\s?C\.?|C\.?\s?B\.?|S\.?\s?L\.?\s?P\.?|S\.?\s?A\.?\s?T\.?|Ltd\.?|Limited|GmbH|Inc\.?|LLC|Asociados|Abogados|Consultores|Consulting|Gestoría|Asesores|Hermanos|Hnos\.?)(?![\p{L}])/u;

export { norm };
