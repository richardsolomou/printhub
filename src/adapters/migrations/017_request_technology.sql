ALTER TABLE requests ADD COLUMN technology TEXT NOT NULL DEFAULT 'resin' CHECK (technology IN ('resin', 'fdm'));

CREATE INDEX requests_technology ON requests(technology);
CREATE INDEX requests_printer_id ON requests(printer_id);
